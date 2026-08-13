use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ComPortInfo {
    pub name: String,
    pub description: String,
}

/// Lee del registro de Windows (vía `reg.exe`, sin dependencias extra — patrón curl.exe)
/// el nombre de los dispositivos Bluetooth que exponen un puerto COM virtual.
/// Devuelve mapa "COM7" → "MP58-04BLE". Vacío si no hay equipos pareados o falla la lectura.
fn bluetooth_friendly_names() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let out = match Command::new("reg")
        .args(["query", "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM", "/s", "/v", "PortName"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return map,
    };
    let text = String::from_utf8_lossy(&out.stdout);
    for (com, addr) in parse_bthenum_output(&text) {
        if let Some(name) = bluetooth_device_name(&addr) {
            map.insert(com, name);
        }
    }
    map
}

/// Parsea la salida de `reg query ... /s /v PortName`:
/// ```text
/// HKEY_LOCAL_MACHINE\...\BTHENUM\{00001101-...}\LOCALMFG&0002&0000&P2-6\7&1a2b3c&0&D75FE8E1A25C\0000\Device Parameters
///     PortName    REG_SZ    COM7
/// ```
/// Devuelve (puerto COM, dirección BT en reverse-MAC) por cada dispositivo.
fn parse_bthenum_output(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut key = String::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("HKEY_") {
            key = line.to_string();
            continue;
        }
        if key.is_empty() || !key.ends_with("\\Device Parameters") {
            continue;
        }
        if !line.contains("PortName") || !line.contains("REG_SZ") {
            continue;
        }
        let com = line.split_whitespace().find(|t| t.starts_with("COM")).map(|t| t.to_string());
        if let Some(com) = com {
            if let Some(addr) = mac_from_device_path(&key) {
                out.push((com, addr));
            }
        }
    }
    out
}

/// Extrae la dirección Bluetooth (formato reverse-MAC, ej. `D75FE8E1A25C`) del
/// segmento `&XXXX...` del path de un dispositivo BTHENUM.
fn mac_from_device_path(path: &str) -> Option<String> {
    let seg = path.rsplit('\\').find(|s| s.contains('&'))?;
    let addr = seg.rsplit('&').next()?;
    if addr.len() == 12 && addr.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(addr.to_string())
    } else {
        None
    }
}

/// Consulta el nombre amigable del equipo Bluetooth (ej. "MP58-04BLE") en
/// `BTHPORT\Parameters\Devices\<ADDR>\Name`.
fn bluetooth_device_name(addr: &str) -> Option<String> {
    let out = Command::new("reg")
        .args([
            "query",
            &format!("HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices\\{addr}"),
            "/v",
            "Name",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find_map(|l| {
        let parts: Vec<&str> = l.trim().split_whitespace().collect();
        if parts.first().copied() == Some("Name") && parts.contains(&"REG_SZ") {
            parts.get(2).map(|s| s.to_string())
        } else {
            None
        }
    })
}

/// Enumerar puertos COM disponibles (detección automática de la impresora térmica).
/// En Windows, las impresoras térmicas aparecen como COMx: USB serial (con
/// fabricante/producto del USB) o Bluetooth (con el nombre del equipo pareado).
pub fn list_com_ports() -> Result<Vec<ComPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| format!("No se pudieron listar los puertos: {e}"))?;
    let bt_names = bluetooth_friendly_names();
    let mut out: Vec<ComPortInfo> = Vec::with_capacity(ports.len());
    for p in ports {
        let desc = match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => {
                let mut parts: Vec<String> = Vec::new();
                if let Some(m) = usb.manufacturer.as_deref().filter(|s| !s.is_empty()) {
                    parts.push(m.to_string());
                }
                if let Some(pr) = usb.product.as_deref().filter(|s| !s.is_empty()) {
                    parts.push(pr.to_string());
                }
                if parts.is_empty() {
                    parts.push(format!("USB {:04X}:{:04X}", usb.vid, usb.pid));
                }
                parts.join(" · ")
            }
            serialport::SerialPortType::BluetoothPort => match bt_names.get(&p.port_name) {
                Some(name) => format!("Bluetooth · {name}"),
                None => "Bluetooth".to_string(),
            },
            serialport::SerialPortType::PciPort => "PCI".to_string(),
            serialport::SerialPortType::Unknown => "Puerto serial".to_string(),
        };
        out.push(ComPortInfo { name: p.port_name, description: desc });
    }
    Ok(out)
}

// ============================================================================
// Impresión vía Windows Print Spooler (impresoras instaladas como "driver",
// ej. HPRT MPT-II en USB001, POS-58, etc.). Sin dependencias: FFI directo a
// winspool.drv (patrón curl.exe/reg.exe del proyecto).
// ============================================================================

#[cfg(target_os = "windows")]
mod winspool {
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    struct DocInfo1W {
        p_doc_name: *mut u16,
        p_output_file: *mut u16,
        p_datatype: *mut u16,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn OpenPrinterW(
            p_printer_name: *const u16,
            ph_printer: *mut *mut c_void,
            p_default: *const c_void,
        ) -> i32;
        fn ClosePrinter(h_printer: *mut c_void) -> i32;
        fn StartDocPrinterW(h_printer: *mut c_void, level: u32, p_doc_info: *const DocInfo1W) -> i32;
        fn StartPagePrinter(h_printer: *mut c_void) -> i32;
        fn WritePrinter(
            h_printer: *mut c_void,
            p_buf: *const u8,
            cb_buf: u32,
            pc_written: *mut u32,
        ) -> i32;
        fn EndPagePrinter(h_printer: *mut c_void) -> i32;
        fn EndDocPrinter(h_printer: *mut c_void) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Lista los nombres de impresoras instaladas (spooler de Windows).
    /// Se usa powershell.exe Get-CimInstance (patrón curl.exe/reg.exe del
    /// proyecto): EnumPrintersW devolvía structs inestables (crash 0xc0000005
    /// en esta PC — lección Entropy Registry 2026-08-11) y el FFI no es fiable
    /// entre builds de Windows. Get-CimInstance viene con Windows 10+.
    pub fn list_printers() -> Vec<String> {
        let out = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }",
            ])
            .output();
        match out {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Envía bytes crudos (datatype RAW) a una impresora del spooler de Windows.
    /// No pasa por el driver de renderizado: el spooler escribe directo al puerto,
    /// ideal para ESC/POS (impresoras térmicas).
    pub fn print_raw(printer: &str, bytes: &[u8]) -> Result<(), String> {
        let name = wide(printer);
        let doc_name = wide("Registro - Ticket");
        let datatype = wide("RAW");
        let mut h: *mut c_void = ptr::null_mut();
        unsafe {
            if OpenPrinterW(name.as_ptr(), &mut h, ptr::null()) == 0 {
                return Err(format!(
                    "No se pudo abrir la impresora de Windows \"{printer}\". Revisa que esté instalada y encendida."
                ));
            }
            let doc = DocInfo1W {
                p_doc_name: doc_name.as_ptr() as *mut u16,
                p_output_file: ptr::null_mut(),
                p_datatype: datatype.as_ptr() as *mut u16,
            };
            if StartDocPrinterW(h, 1, &doc) == 0 {
                ClosePrinter(h);
                return Err(format!("No se pudo iniciar el trabajo de impresión en \"{printer}\"."));
            }
            let mut written: u32 = 0;
            let ok_page = StartPagePrinter(h) != 0;
            let ok_write = ok_page && WritePrinter(h, bytes.as_ptr(), bytes.len() as u32, &mut written) != 0;
            if ok_write {
                EndPagePrinter(h);
            }
            EndDocPrinter(h);
            ClosePrinter(h);
            if !ok_write {
                return Err(format!(
                    "Error al escribir en \"{printer}\" (enviados {written} de {} bytes). Verifica que la impresora esté conectada y encendida.",
                    bytes.len()
                ));
            }
            Ok(())
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod winspool {
    pub fn list_printers() -> Vec<String> {
        Vec::new()
    }
    pub fn print_raw(printer: &str, _bytes: &[u8]) -> Result<(), String> {
        Err(format!("Impresión a Windows no disponible en esta plataforma ({printer})"))
    }
}

/// Lista las impresoras instaladas en Windows (spooler): las que aparecen en
/// Configuración → Dispositivos → Impresoras. Ej: "HPRT MPT-II", "POS-58".
pub fn list_windows_printers() -> Result<Vec<String>, String> {
    Ok(winspool::list_printers())
}

/// Imprime un ticket ESC/POS a una impresora de Windows (spooler, datatype RAW).
/// Ideal para impresoras instaladas con driver oficial (ej. HPRT MPT-II en USB001).
/// `terms` = bloque de letra pequeña (font B) que se imprime entre `text` y `footer`
/// (talón recortable "CORTA TIJERA") — las condiciones quedan en la PRIMERA copia.
/// `raster` = logo monocromo empaquetado (1 bit por píxel, 1 = negro), `raster_width` = ancho en píxeles
/// (384 para 58 mm, 576 para 80 mm). El logo se imprime al inicio, antes del texto.
pub fn print_to_windows_printer(
    printer: &str,
    text: &str,
    terms: Option<&str>,
    footer: Option<&str>,
    raster: Option<&[u8]>,
    raster_width: Option<u32>,
) -> Result<(), String> {
    if printer.trim().is_empty() {
        return Err("No hay impresora de Windows seleccionada.".to_string());
    }
    let lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    let foot_lines: Vec<String> = footer.unwrap_or("").lines().map(|l| l.to_string()).collect();
    let foot = (!foot_lines.is_empty()).then_some(foot_lines);
    let bytes = build_escpos_with_logo(&lines, terms, foot.as_deref(), raster, raster_width);
    winspool::print_raw(printer, &bytes)
}

/// Estado del spooler para una impresora de Windows (patrón powershell.exe del
/// proyecto): ¿está conectada/lista, en pausa, sin papel, o falló el último job?
/// Devuelve texto listo para mostrar al usuario ("Lista", "Fuera de línea", ...).
pub fn get_windows_printer_status(printer: &str) -> Result<String, String> {
    if printer.trim().is_empty() {
        return Ok("Sin impresora seleccionada".to_string());
    }
    // Nombres con comillas romperían el script PowerShell interpolado (inyección WQL):
    // estado no consultable, sin tocar el spooler. Nombres así son exóticos (nunca vistos).
    if printer.contains('\'') || printer.contains('"') {
        return Ok("Estado no consultable (el nombre de la impresora tiene caracteres especiales)".to_string());
    }
    let out = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "$p = Get-CimInstance Win32_Printer -Filter \"Name='{0}'\" -ErrorAction SilentlyContinue; if (-not $p) {{ 'NO_INSTALADA' }} elseif ($p.Offline) {{ 'FUERA_DE_LINEA' }} elseif ($p.PrinterStatus -eq 4) {{ 'EN_PAUSA' }} elseif ($p.PrinterStatus -eq 3) {{ 'SIN_PAPEL' }} elseif ($p.PrinterStatus -ne 3) {{ $j = Get-PrintJob -PrinterName '{0}' -ErrorAction SilentlyContinue | Where-Object {{ $_.JobStatus -like '*Error*' }}; if ($j) {{ 'ERROR_EN_COLA' }} else {{ 'LISTA' }} }} else {{ 'LISTA' }}",
                printer
            ),
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout);
            let status = text.lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("DESCONOCIDO");
            let label = match status {
                "LISTA" => "Lista — la impresora está conectada y lista".to_string(),
                "FUERA_DE_LINEA" => "Fuera de línea — revisa que esté encendida y el cable USB conectado".to_string(),
                "EN_PAUSA" => "En pausa — ábrela en Configuración → Impresoras y reanuda la cola".to_string(),
                "SIN_PAPEL" => "Sin papel — coloca el rollo térmico e imprime de nuevo".to_string(),
                "ERROR_EN_COLA" => "El trabajo quedó con error en la cola — revisa el estado en Configuración → Impresoras".to_string(),
                "NO_INSTALADA" => "No instalada en Windows — instala el driver y reinicia la app".to_string(),
                _ => format!("Estado: {status}"),
            };
            Ok(label)
        }
        _ => Ok("No se pudo consultar el estado del spooler".to_string()),
    }
}

/// Codifica texto a CP850 (Latin-1 extendido) — el set de caracteres estándar que
/// entienden las impresoras térmicas ESC/POS para acentos y ñ. Caracteres no
/// mapeables caen a '?' (nunca rompe el ticket).
pub fn cp850_encode(s: &str) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(s.len());
    for c in s.chars() {
        let b = match c {
            ' '..='~' => c as u8,
            'á' => 0xA0, 'é' => 0x82, 'í' => 0xA1, 'ó' => 0xA2, 'ú' => 0xA3,
            'ñ' => 0xA4, 'ü' => 0x81, '¿' => 0xA8, '¡' => 0xAC, '°' => 0xF8,
            'Á' => 0xB5, 'É' => 0x90, 'Í' => 0xD6, 'Ó' => 0xE0, 'Ú' => 0xE9,
            'Ñ' => 0xA5, 'Ü' => 0x9A, 'ª' => 0xA6, 'º' => 0xA7, '·' => 0xFA,
            '€' => 0xD5, 'ç' => 0x87, 'Ç' => 0x80, 'à' => 0x85, 'À' => 0xB7,
            'è' => 0x8A, 'È' => 0x8F, 'â' => 0x83, 'ê' => 0x88, 'î' => 0x8C,
            'ô' => 0x93, 'û' => 0x96, 'ù' => 0x97, 'ò' => 0x95, 'ì' => 0x8D,
            '–' => 0x96, '—' => 0x97, '«' => 0xAD, '»' => 0xAE,
            _ => 0x3F, // '?'
        };
        out.push(b);
    }
    out
}

/// Construye el comando ESC/POS de gráfico raster (GS v 0) para el logo monocromo.
/// `width_px`: ancho en píxeles (384 típico de impresoras de 58 mm, 576 para 80 mm).
/// `payload`: filas empaquetadas a 1 bit (1 = negro), tantos bytes por fila como
/// `ceil(width_px / 8)`. Devuelve None si el payload no cuadra con el ancho.
pub fn escpos_raster(width_px: u16, payload: &[u8]) -> Option<Vec<u8>> {
    let bytes_per_line = (width_px as usize).div_ceil(8);
    if bytes_per_line == 0 || payload.is_empty() || payload.len() % bytes_per_line != 0 {
        return None;
    }
    let height = (payload.len() / bytes_per_line) as u16;
    let mut cmd: Vec<u8> = vec![0x1D, 0x76, 0x30, 0x00]; // GS v 0 m=0 (normal)
    cmd.push((bytes_per_line & 0xFF) as u8); // xL
    cmd.push(((bytes_per_line >> 8) & 0xFF) as u8); // xH
    cmd.push((height & 0xFF) as u8); // yL
    cmd.push(((height >> 8) & 0xFF) as u8); // yH
    cmd.extend_from_slice(payload);
    Some(cmd)
}

/// Construye el flujo ESC/POS completo para el ticket, con logo raster opcional:
/// init → logo (GS v 0) → cuerpo (CR LF) → [ESC d 2 → ESC M 1 (font B) → términos →
/// ESC M 0] → talón (font A, ej. CORTA TIJERA) → alimentación → corte.
pub fn build_escpos_with_logo(
    lines: &[String],
    terms: Option<&str>,
    footer: Option<&[String]>,
    raster: Option<&[u8]>,
    raster_width: Option<u32>,
) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"\x1B\x40"); // ESC @ — inicializar impresora
    if let (Some(r), Some(w)) = (raster, raster_width) {
        if w > 0 && w as u16 != 0 && w <= 2000 {
            if let Some(logo) = escpos_raster(w as u16, r) {
                out.extend_from_slice(&logo);
            }
        }
    }
    for line in lines {
        out.extend_from_slice(&cp850_encode(line));
        out.extend_from_slice(b"\x0D\x0A"); // CR LF
    }
    if let Some(terms) = terms {
        let term_lines: Vec<&str> = terms.lines().collect();
        if !term_lines.is_empty() {
            out.extend_from_slice(b"\x1B\x64\x02"); // ESC d 2 — separar del cuerpo
            out.extend_from_slice(b"\x1B\x4D\x01"); // ESC M 1 — letra pequeña (font B)
            for line in term_lines {
                out.extend_from_slice(&cp850_encode(line));
                out.extend_from_slice(b"\x0D\x0A");
            }
            out.extend_from_slice(b"\x1B\x4D\x00"); // ESC M 0 — restaurar font A
        }
    }
    if let Some(footer) = footer {
        for line in footer {
            out.extend_from_slice(&cp850_encode(line));
            out.extend_from_slice(b"\x0D\x0A");
        }
    }
    out.extend_from_slice(b"\x1B\x64\x05"); // ESC d 5 — alimentar 5 líneas antes del corte
    out.extend_from_slice(b"\x1D\x56\x42"); // GS V B — corte parcial (papel no vuela)
    out
}

/// Construye el flujo ESC/POS completo para el ticket:
/// init → líneas (CR LF) → alimentación → corte de papel.
pub fn build_escpos(lines: &[String]) -> Vec<u8> {
    build_escpos_with_logo(lines, None, None, None, None)
}

/// Imprime un ticket en el puerto COM indicado.
/// `text` es texto plano con saltos de línea; se codifica a CP850 y se envía con
/// el protocolo ESC/POS (init + logo opcional + líneas + términos en font B + corte).
/// Tope duro de 10 s: el driver de puertos Bluetooth puede bloquear Open/Write
/// más allá del timeout serial y dejar la UI "pensando" — aquí el hilo se
/// abandona en segundo plano y la app responde con un error claro.
pub fn print_receipt(
    port: &str,
    baud: u32,
    text: &str,
    terms: Option<&str>,
    footer: Option<&str>,
    raster: Option<&[u8]>,
    raster_width: Option<u32>,
) -> Result<(), String> {
    if port.trim().is_empty() {
        return Err("No hay impresora configurada. Configúrala en Impresora de tickets.".to_string());
    }
    let port_owned = port.to_string();
    let text_owned = text.to_string();
    let terms_owned = terms.map(|t| t.to_string());
    let footer_owned = footer.map(|t| t.to_string());
    let raster_owned = raster.map(|r| r.to_vec());
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let _ = tx.send(print_receipt_inner(&port_owned, baud, &text_owned, terms_owned.as_deref(), footer_owned.as_deref(), raster_owned.as_deref(), raster_width));
    });
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(res) => res,
        Err(_) => {
            if bluetooth_friendly_names().contains_key(port) {
                Err(format!(
                    "La impresora Bluetooth ({port}) no respondió en 10 segundos. \
                     Verifica que esté ENCENDIDA y cerca de la PC, y que no esté conectada a otro equipo."
                ))
            } else {
                Err(format!(
                    "No se pudo imprimir en {port}: la impresora no respondió a tiempo. \
                     Revisa que esté conectada y encendida."
                ))
            }
        }
    }
}

fn print_receipt_inner(
    port: &str,
    baud: u32,
    text: &str,
    terms: Option<&str>,
    footer: Option<&str>,
    raster: Option<&[u8]>,
    raster_width: Option<u32>,
) -> Result<(), String> {
    let is_bt = bluetooth_friendly_names().contains_key(port);
    let mut serial = serialport::new(port, baud)
        .timeout(Duration::from_secs(5))
        .open()
        .map_err(|e| {
            if is_bt {
                format!("No se pudo abrir {port}: {e}. Si es Bluetooth, verifica que la impresora esté pareada (Configuración → Bluetooth → Más opciones → Puertos COM) y encendida.")
            } else {
                format!("No se pudo abrir {port}: {e}. Revisa que la impresora esté conectada.")
            }
        })?;
    let lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    let foot_lines: Vec<String> = footer.unwrap_or("").lines().map(|l| l.to_string()).collect();
    let foot = (!foot_lines.is_empty()).then_some(foot_lines);
    let bytes = build_escpos_with_logo(&lines, terms, foot.as_deref(), raster, raster_width);
    serial
        .write_all(&bytes)
        .and_then(|_| serial.flush())
        .map_err(|e| {
            if is_bt {
                format!(
                    "Error al imprimir en {port} (Bluetooth): {e}. \
                     Verifica que la impresora esté ENCENDIDA y cerca, y que no esté conectada a otro equipo."
                )
            } else {
                format!("Error al imprimir en {port}: {e}. Revisa que la impresora esté conectada.")
            }
        })
}

/// Prueba de conexión de un puerto COM sin imprimir nada visible: abre el puerto
/// y envía `ESC @` (init). Usado por la UI para marcar en vivo qué impresoras
/// responden ("captar" las disponibles). Tope duro de 3 s — un driver BT muerto
/// no puede colgar la detección.
pub fn probe_com_port(port: &str, baud: u32) -> Result<(), String> {
    if port.trim().is_empty() {
        return Err("Puerto vacío".to_string());
    }
    let port_owned = port.to_string();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let _ = tx.send(probe_com_port_inner(&port_owned, baud));
    });
    match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(r) => r,
        Err(_) => Err(format!("La impresora en {port} no respondió a tiempo (3 s).")),
    }
}

fn probe_com_port_inner(port: &str, baud: u32) -> Result<(), String> {
    let mut serial = serialport::new(port, baud)
        .timeout(Duration::from_secs(2))
        .open()
        .map_err(|e| format!("No se pudo abrir {port}: {e}"))?;
    serial
        .write_all(b"\x1B\x40")
        .and_then(|_| serial.flush())
        .map_err(|e| format!("La impresora no respondió: {e}"))?;
    Ok(())
}

/// Ticket de prueba corto (configuración del puerto).
pub fn test_ticket() -> String {
    [
        "REGISTRO - SERVICIO TECNICO",
        "------------------------------",
        "  Prueba de impresora OK",
        "  Si ves este texto, el",
        "  puerto esta bien configurado.",
        "",
        "  fecha: 2026-08-04",
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cp850_spanish() {
        let enc = cp850_encode("áéíóúñü¿¡°ÑÜÉºª·");
        // Bytes CP850 verificados para el español
        assert_eq!(enc, vec![0xA0, 0x82, 0xA1, 0xA2, 0xA3, 0xA4, 0x81, 0xA8, 0xAC, 0xF8, 0xA5, 0x9A, 0x90, 0xA7, 0xA6, 0xFA]);
        assert_eq!(cp850_encode("ABC 123"), b"ABC 123".to_vec());
        // Caracteres no mapeables -> '?'
        assert_eq!(cp850_encode("☺"), b"?".to_vec());
    }

    #[test]
    fn test_escpos_structure() {
        let lines = vec!["REGISTRO".to_string(), "Gracias".to_string()];
        let bytes = build_escpos(&lines);
        assert!(bytes.starts_with(b"\x1B\x40"), "Debe iniciar con ESC @");
        assert!(bytes.windows(2).any(|w| w == b"\x0D\x0A"), "Líneas terminan en CR LF");
        assert!(bytes.ends_with(b"\x1D\x56\x42"), "Debe cortar papel al final (GS V B)");
        assert!(bytes.windows(2).any(|w| w == b"\x1B\x64"), "Debe alimentar papel");
        // El texto pasa codificado CP850
        let with_n = build_escpos(&["Mañana".to_string()]);
        assert!(with_n.contains(&0xA4), "La ñ se codifica CP850 (0xA4)");
    }

    #[test]
    fn test_escpos_raster_header() {
        // 384 píxeles = 48 bytes por fila; 30 filas de payload alternado
        let payload: Vec<u8> = (0..48 * 30).map(|i| if i % 2 == 0 { 0xAA } else { 0x55 }).collect();
        let cmd = escpos_raster(384, &payload).expect("payload válido");
        assert_eq!(&cmd[0..6], &[0x1D, 0x76, 0x30, 0x00, 48, 0], "GS v 0 m=0 xL=48 xH=0");
        assert_eq!(&cmd[6..8], &[30, 0], "yL=30 yH=0 (30 filas)");
        assert_eq!(cmd.len(), 8 + payload.len(), "8 bytes de cabecera + payload");
        assert_eq!(&cmd[8..], &payload[..]);
    }

    #[test]
    fn test_escpos_raster_rejects_bad_payload() {
        assert!(escpos_raster(384, &[]).is_none(), "vacío");
        assert!(escpos_raster(384, &[1, 2, 3]).is_none(), "no múltiplo de 48");
        assert!(escpos_raster(0, &[0]).is_none(), "ancho 0");
        // 80 mm: 576 px = 72 bytes/fila
        let payload = vec![0xFF; 72 * 10];
        let cmd = escpos_raster(576, &payload).expect("payload válido 80mm");
        assert_eq!(&cmd[0..6], &[0x1D, 0x76, 0x30, 0x00, 72, 0]);
        assert_eq!(&cmd[6..8], &[10, 0]);
    }

    #[test]
    fn test_build_escpos_with_logo_order() {
        let lines = vec!["HOLA".to_string()];
        let payload = vec![0x00; 48 * 2];
        let bytes = build_escpos_with_logo(&lines, None, None, Some(&payload), Some(384));
        assert!(bytes.starts_with(b"\x1B\x40"), "ESC @ primero");
        assert_eq!(&bytes[2..8], &[0x1D, 0x76, 0x30, 0x00, 48, 0], "logo raster tras init");
        // El texto queda después del payload del logo
        let expected = 2 /*ESC@*/ + 8 /*cabecera GS v 0*/ + payload.len() + 4 + 2 /*HOLA CR LF*/ + 3 /*ESC d 5*/ + 3 /*GS V B*/;
        assert_eq!(bytes.len(), expected, "init+logo+texto+feed+corte");
        assert!(bytes.ends_with(b"\x1D\x56\x42"), "corte final");
        // Sin logo se comporta como build_escpos
        let plain = build_escpos(&lines);
        assert_eq!(build_escpos_with_logo(&lines, None, None, None, None), plain);
        // Raster inválido + ancho 0 → se ignora sin romper el ticket
        assert_eq!(build_escpos_with_logo(&lines, None, None, Some(&[9, 9]), Some(0)), plain);
    }

    #[test]
    fn test_escpos_terms_font_b() {
        // El bloque de términos se imprime en letra pequeña (ESC M 1 font B),
        // ENTRE el cuerpo y el talón (footer), y se restaura la font A (ESC M 0).
        let lines = vec!["BODY".to_string()];
        let terms = Some("CONDICIONES DEL SERVICIO\nLINEA PEQUEÑA");
        let footer = vec!["--- CORTA TIJERA ---".to_string(), "FIRMA SALIDA".to_string()];
        let bytes = build_escpos_with_logo(&lines, terms, Some(&footer), None, None);
        let start = bytes.windows(3).position(|w| w == b"\x1B\x4D\x01").expect("ESC M 1 (font B)");
        let end = bytes.windows(3).position(|w| w == b"\x1B\x4D\x00").expect("ESC M 0 (font A)");
        assert!(end > start, "font B antes de restaurar font A");
        let block = &bytes[start + 3..end];
        assert!(block.windows(8).any(|w| w == "CONDICIO".as_bytes()), "términos dentro del bloque");
        assert!(block.windows(2).any(|w| w == b"\x0D\x0A"), "líneas CR LF");
        // El talón va DESPUÉS de los términos y en font A (sin ESC M 1 entre medias)
        let tail = &bytes[end + 3..];
        assert!(tail.windows(7).any(|w| w == "CORTA T".as_bytes()), "talón tras los términos");
        assert!(!tail.windows(3).any(|w| w == b"\x1B\x4D\x01"), "talón en font A");
        assert!(bytes.ends_with(b"\x1D\x56\x42"), "corte al final");
        // Sin términos ni talón → sin secuencias de font B
        let plain = build_escpos_with_logo(&lines, None, None, None, None);
        assert!(!plain.windows(3).any(|w| w == b"\x1B\x4D\x01"));
        // Términos vacíos (solo líneas en blanco) → tampoco inyecta font B
        let empty_terms = build_escpos_with_logo(&lines, Some(""), None, None, None);
        assert_eq!(empty_terms, plain);
    }

    #[test]
    fn test_test_ticket() {
        let t = test_ticket();
        assert!(t.contains("Prueba de impresora"));
        assert!(t.lines().count() > 3);
    }

    #[test]
    fn test_parse_bthenum_output() {
        // Salida real de `reg query ... /s /v PortName` (esquema BTHENUM de Windows)
        let sample = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\LOCALMFG&0002&0000&P2-6\\7&1a2b3c&0&D75FE8E1A25C\\0000\\Device Parameters\n    PortName    REG_SZ    COM7\n\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\LOCALMFG&0002&0000&P2-6\\7&1a2b3c&0&D75FE8E1A25C\\0001\\Device Parameters\n    PortName    REG_SZ    COM8";
        let pairs = parse_bthenum_output(sample);
        assert_eq!(pairs.len(), 2, "dos dispositivos Bluetooth con COM");
        assert_eq!(pairs[0], ("COM7".to_string(), "D75FE8E1A25C".to_string()));
        assert_eq!(pairs[1], ("COM8".to_string(), "D75FE8E1A25C".to_string()));
    }

    #[test]
    fn test_parse_bthenum_ignores_no_com() {
        // Dispositivos sin PortName (p.ej. BT LE sin SPP) no deben mapearse
        let sample = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\LOCALMFG&0002&0000&P2-6\\7&1a2b3c&0&D75FE8E1A25C\\0000\\Device Parameters\n    PortName    REG_SZ    COM7\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\LOCALMFG&0002&0000&P2-6\\7&1a2b3c&0&DEADBEEF1234\n    NoPort    REG_SZ    nada";
        let pairs = parse_bthenum_output(sample);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "COM7");
    }

    #[test]
    fn test_mac_from_device_path() {
        let path = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\LOCALMFG&0002&0000&P2-6\\7&1a2b3c&0&D75FE8E1A25C\\0000\\Device Parameters";
        assert_eq!(mac_from_device_path(path).as_deref(), Some("D75FE8E1A25C"));
        // Sin segmento &addr válido
        assert_eq!(mac_from_device_path("HKLM\\BTHENUM\\foo\\0000\\Device Parameters"), None);
        assert_eq!(mac_from_device_path("HKLM\\BTHENUM\\x&ZZZ\\0000"), None);
    }

    #[test]
    fn test_bluetooth_friendly_names_never_panics() {
        // En una PC sin Bluetooth o sin equipos pareados debe devolver mapa vacío
        // (nunca un error que tumbe list_com_ports).
        let map = bluetooth_friendly_names();
        for (com, name) in &map {
            assert!(com.starts_with("COM"), "clave debe ser COMx: {com}");
            assert!(!name.is_empty());
        }
    }

    #[test]
    fn test_list_windows_printers_never_panics() {
        // Debe listar impresoras del spooler sin paniquear (normalmente hay al menos
        // "Microsoft Print to PDF" en cualquier Windows). Solo verifica que corra.
        let printers = list_windows_printers().unwrap_or_default();
        for p in &printers {
            assert!(!p.trim().is_empty(), "nombre de impresora vacío");
        }
    }

    #[test]
    fn test_print_to_windows_printer_errors() {
        // Impresora vacía → error amigable (nunca panica ni toca el spooler)
        let err = print_to_windows_printer("", "hola", None, None, None, None).unwrap_err();
        assert!(err.contains("No hay impresora"), "error: {err}");
        // Impresora inexistente → error amigable (o en su defecto cualquier error/ok
        // controlado, NUNCA panic)
        let _ = print_to_windows_printer("_impresora_que_no_existe_12345_", "hola", None, None, Some(&[0x00; 48]), Some(384));
    }
}
