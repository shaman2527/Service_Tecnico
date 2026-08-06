# release.ps1 — Publica una versión nueva: build firmado + latest.json + GitHub Release + respaldo Google Drive.
# Uso: .\tools\release.ps1 -Version 0.1.2 -Notes "Fix X, mejora Y"
# Requisitos: gh auth login (una vez) + llave privada en C:\Users\$env:USERNAME\.tauri\registro.key
# Drive (opcional, respaldo si GitHub está bloqueado): tools\drive_ids.json con
#   { "latest_id": "<FILE_ID del latest.json en Drive>", "setup_id": "<FILE_ID del setup.exe en Drive>" }
#   Los FILE_ID NUNCA cambian si se re-suben los archivos SOBRE los mismos (cambiar contenido, no crear archivos nuevos).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = "Mejoras y correcciones",
    [string]$DriveLatestId = "",
    [string]$DriveSetupId = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# 0) Validar versión semver
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versión inválida: $Version (usa 0.1.2)" }

# 1) Repo limpio (sin cambios sin commitear)
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "Cambios sin commitear:" -ForegroundColor Yellow
    $dirty
    $yn = Read-Host "¿Continuar igual (los cambios se incluirán en el commit final)? [s/N]"
    if ($yn -notin @("s", "S", "si", "SI")) { throw "Cancelado" }
}

# 2) Subir versión en tauri.conf.json y Cargo.toml
Step "Bump versión a $Version"
$conf = Get-Content "src-tauri\tauri.conf.json" -Raw
$conf = $conf -replace '"version": "\d+\.\d+\.\d+"', ('"version": "' + $Version + '"')
Set-Content "src-tauri\tauri.conf.json" $conf -NoNewline
$cargo = Get-Content "src-tauri\Cargo.toml" -Raw
$cargo = $cargo -replace '(?m)^version = "\d+\.\d+\.\d+"', ('version = "' + $Version + '"')
Set-Content "src-tauri\Cargo.toml" $cargo -NoNewline

# 3) Tests
Step "cargo test"
Push-Location src-tauri
cargo test | Out-Host
if ($LASTEXITCODE -ne 0) { throw "cargo test falló" }
Pop-Location

# 4) Build firmado (genera setup.exe + .sig)
Step "npx tauri build (firmado)"
$keyPath = Join-Path $env:USERPROFILE ".tauri\registro.key"
if (-not (Test-Path $keyPath)) { throw "No existe la llave privada: $keyPath" }
$env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npx tauri build | Out-Host
if ($LASTEXITCODE -ne 0) { throw "tauri build falló" }

$setup = "src-tauri\target\release\bundle\nsis\Registro Servicio Tecnico_${Version}_x64-setup.exe"
$sig = "$setup.sig"
if (-not (Test-Path $setup)) { throw "No se encontró el instalador: $setup" }
if (-not (Test-Path $sig)) { throw "No se encontró la firma: $sig (¿falta TAURI_SIGNING_PRIVATE_KEY?)" }

# 5) Copias locales (Registro.exe + DB junto al exe de trabajo)
Step "Copias locales"
Copy-Item "src-tauri\target\release\registro.exe" "Registro.exe" -Force
Copy-Item "registro.db" "src-tauri\target\release\registro.db" -Force

# 6) latest.json (manifesto del updater)
Step "latest.json"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$signature = (Get-Content $sig -Raw).Trim()
# GitHub normaliza espacios -> puntos en los nombres de assets al subir (gh release).
# La URL del manifesto DEBE usar el nombre normalizado o la descarga da 404.
$setupLeaf = (Split-Path $setup -Leaf) -replace ' ', '.'
# Canal de actualizaciones = repo PUBLICO de releases (el repo de código es PRIVADO;
# GitHub no sirve assets de repos privados sin auth, el updater no lleva token).
$releaseRepo = "shaman2527/Service_Tecnico-Releases"
$setupUrl = "https://github.com/$releaseRepo/releases/download/v$Version/" + [uri]::EscapeDataString($setupLeaf)
$latest = @{
    version  = $Version
    notes    = $Notes
    pub_date = $pubDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $signature
            url       = $setupUrl
        }
    }
} | ConvertTo-Json -Depth 5
Set-Content "src-tauri\target\release\bundle\nsis\latest.json" $latest -Encoding utf8
Write-Host "Manifesto:" -ForegroundColor Green
$latest

# 7) Manifesto Drive (respaldo si GitHub está bloqueado — endpoint 2 del updater)
Step "latest_drive.json (Google Drive)"
$driveConfig = "tools\drive_ids.json"
if (-not $DriveLatestId -and (Test-Path $driveConfig)) {
    $ids = Get-Content $driveConfig -Raw | ConvertFrom-Json
    $DriveLatestId = $ids.latest_id
    $DriveSetupId = $ids.setup_id
}
if ($DriveLatestId -and $DriveSetupId) {
    $setupUrlDrive = "https://drive.usercontent.google.com/download?id=$DriveSetupId&export=download"
    $latestDrive = @{
        version   = $Version
        notes     = $Notes
        pub_date  = $pubDate
        platforms = @{
            "windows-x86_64" = @{
                signature = $signature
                url       = $setupUrlDrive
            }
        }
    } | ConvertTo-Json -Depth 5
    Set-Content "src-tauri\target\release\bundle\nsis\latest_drive.json" $latestDrive -Encoding utf8
    Write-Host "Manifesto Drive:" -ForegroundColor Green
    $latestDrive
    Write-Host "SUBIR a Drive (SOBRESCRIBIENDO los archivos existentes, mismo nombre y misma carpeta):" -ForegroundColor Yellow
    Write-Host "  1. Sube 'latest_drive.json' sobre el latest.json de Drive (reemplazar)" -ForegroundColor Yellow
    Write-Host "  2. Sube '$([IO.Path]::GetFileName($setup))' sobre el setup de Drive (reemplazar)" -ForegroundColor Yellow
    Write-Host "  (Los enlaces de descarga NO cambian: los IDs de archivo son estables.)" -ForegroundColor Yellow
} else {
    Write-Host "Drive no configurado (opcional). Para activarlo:" -ForegroundColor Yellow
    Write-Host "  1. Sube una vez a Drive: latest.json + setup.exe (públicos, cualquiera con el enlace)" -ForegroundColor Yellow
    Write-Host "  2. Crea tools\drive_ids.json: { `"latest_id`": `"<ID del latest.json>`", `"setup_id`": `"<ID del setup.exe>`" }" -ForegroundColor Yellow
    Write-Host "  (IDs de enlace: https://drive.google.com/file/d/<ID>/view)" -ForegroundColor Yellow
}

# 8) Copiar a instaladores\ (pendrive)
Step "Carpeta instaladores"
$instDir = "instaladores"
New-Item -ItemType Directory -Force -Path $instDir | Out-Null
Copy-Item $setup $instDir -Force
Copy-Item "src-tauri\target\release\bundle\nsis\latest.json" $instDir -Force
if (Test-Path "src-tauri\target\release\bundle\nsis\latest_drive.json") { Copy-Item "src-tauri\target\release\bundle\nsis\latest_drive.json" $instDir -Force }

# 9) GitHub Release (solo si gh está autenticado) — SIEMPRE al repo PUBLICO de releases
Step "GitHub Release v$Version (repo público $releaseRepo)"
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    gh release create "v$Version" `
        "$setup" "$sig" "src-tauri\target\release\bundle\nsis\latest.json" `
        --repo $releaseRepo `
        --title "Registro v$Version" --notes $Notes
    if ($LASTEXITCODE -ne 0) { throw "gh release create falló (intenta: gh auth login)" }
    Write-Host "Release publicada en $releaseRepo. El endpoint del updater ya sirve latest.json." -ForegroundColor Green
} else {
    Write-Host "gh no autenticado — la release NO se publicó." -ForegroundColor Yellow
    Write-Host "Pasos manuales:" -ForegroundColor Yellow
    Write-Host "  1. gh auth login"
    Write-Host "  2. gh release create v$Version `"$setup`" `"$sig`" src-tauri\target\release\bundle\nsis\latest.json --repo $releaseRepo --title `"Registro v$Version`" --notes `"$Notes`""
}

Write-Host "`nLISTO. Instalador en: instaladores\Registro Servicio Tecnico_${Version}_x64-setup.exe" -ForegroundColor Green
Write-Host "Recordatorio: si GitHub está bloqueado, sube latest_drive.json y el setup a Drive (misma carpeta, reemplazar archivos)." -ForegroundColor Green
