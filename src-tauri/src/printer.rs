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

/// Construye el flujo ESC/POS completo para el ticket:
/// init → líneas (CR LF) → alimentación → corte de papel.
pub fn build_escpos(lines: &[String]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"\x1B\x40"); // ESC @ — inicializar impresora
    for line in lines {
        out.extend_from_slice(&cp850_encode(line));
        out.extend_from_slice(b"\x0D\x0A"); // CR LF
    }
    out.extend_from_slice(b"\x1B\x64\x05"); // ESC d 5 — alimentar 5 líneas antes del corte
    out.extend_from_slice(b"\x1D\x56\x42"); // GS V B — corte parcial (papel no vuela)
    out
}

/// Imprime un ticket en el puerto COM indicado.
/// `text` es texto plano con saltos de línea; se codifica a CP850 y se envía con
/// el protocolo ESC/POS (init + líneas + corte).
pub fn print_receipt(port: &str, baud: u32, text: &str) -> Result<(), String> {
    if port.trim().is_empty() {
        return Err("No hay impresora configurada. Configúrala en Impresora de tickets.".to_string());
    }
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
    let bytes = build_escpos(&lines);
    serial
        .write_all(&bytes)
        .and_then(|_| serial.flush())
        .map_err(|e| format!("Error al imprimir en {port}: {e}"))?;
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
}
