use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TasasBCV {
    pub usd: f64,
    pub eur: f64,
}

// Usa curl.exe (incluido en Windows 10+) para evitar dependencias HTTP pesadas.
// -k: acepta certs inválidos del BCV · -s: silencioso · --max-time: timeout 15s
pub fn obtener_tasas() -> Result<TasasBCV, String> {
    let output = std::process::Command::new("curl.exe")
        .args(["-k", "-s", "--max-time", "15", "https://www.bcv.org.ve/glosario/cambio-oficial"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar curl: {}", e))?;

    if !output.status.success() {
        return Err(format!("curl falló con código {}", output.status));
    }

    let html = String::from_utf8_lossy(&output.stdout).to_string();
    if html.trim().is_empty() {
        return Err("Respuesta vacía del BCV".to_string());
    }

    let usd = extract_rate(&html, "USD").ok_or_else(|| "No se encontró la tasa USD en la página del BCV".to_string())?;
    let eur = extract_rate(&html, "EUR").ok_or_else(|| "No se encontró la tasa EUR en la página del BCV".to_string())?;

    Ok(TasasBCV { usd, eur })
}

// Busca <strong class="strong-tb">\d+[.,]\d+</strong> después del marcador (USD/EUR)
fn extract_rate(html: &str, marker: &str) -> Option<f64> {
    let idx = html.find(marker)?;
    let tail = &html[idx..];
    let strong = tail.find("strong-tb")?;
    let after = &tail[strong..];
    let open = after.find('>')?;
    let rest = &after[open + 1..];
    let close = rest.find('<')?;
    let num = rest[..close].trim();
    num.replace(',', ".").parse::<f64>().ok()
}
