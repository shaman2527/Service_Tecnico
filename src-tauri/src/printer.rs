use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ComPortInfo {
    pub name: String,
    pub description: String,
}

/// Enumerar puertos COM disponibles (detección automática de la impresora térmica).
/// En Windows, las impresoras térmicas USB serial aparecen como COMx; se enriquece la
/// descripción con fabricante/producto del USB (VID/PID) cuando el driver lo reporta.
pub fn list_com_ports() -> Result<Vec<ComPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| format!("No se pudieron listar los puertos: {e}"))?;
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
            serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
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
    let mut serial = serialport::new(port, baud)
        .timeout(Duration::from_secs(5))
        .open()
        .map_err(|e| format!("No se pudo abrir {port}: {e}. Revisa que la impresora esté conectada."))?;
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
}
