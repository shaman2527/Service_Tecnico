# release.ps1 - Publica una versión nueva: build firmado + latest.json + GitHub Release + respaldo Google Drive.
# Uso: .\tools\release.ps1 -Version 0.1.2 -Notes "Fix X, mejora Y"
# Requisitos: gh auth login (una vez) + llave privada en C:\Users\$env:USERNAME\.tauri\registro.key
# Drive (opcional, respaldo si GitHub está bloqueado): tools\drive_ids.json con
#   { "latest_id": "<FILE_ID del latest.json en Drive>", "setup_id": "<FILE_ID del setup.exe en Drive>" }
#   Los FILE_ID NUNCA cambian si se re-suben los archivos SOBRE los mismos (cambiar contenido, no crear archivos nuevos).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = "Mejoras y correcciones",
    [string]$DriveLatestId = "",
    [string]$DriveSetupId = "",
    # Solo instalador LOCAL: hace tests + gate + build firmado + copias, y NO publica nada
    # (ni latest.json en GitHub ni Release). Para probar en esta PC sin tocar a los clientes.
    [switch]$NoPublish,
    # Con -NoPublish: si el gate de la plantilla encuentra BLOQUEANTES, avisa fuerte y sigue.
    # NUNCA se permite junto a una publicación (los datos del local no se publican a medias).
    [switch]$AceptarBloqueantes
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

# 3.5) GATE DE LA BASE QUE VIAJA AL INSTALADOR (2026-09-16)
# `tauri.conf.json` empaqueta `../registro.db` como `registro.default.db` y el repo es PÚBLICO:
# si esa base trae órdenes/pagos/clientes (o un WAL con datos sin volcar) la release publicaría
# datos reales del local; y si sale sin precios, una PC nueva no puede cobrar nada. El gate aborta.
Step "gate de release (plantilla de la base)"
node tools/release_gate.mjs
if ($LASTEXITCODE -ne 0) {
    if ($NoPublish -and $AceptarBloqueantes) {
        Write-Host "`n*** ATENCION: el gate encontró BLOQUEANTES (arriba) y seguimos igual porque es un build LOCAL (-NoPublish -AceptarBloqueantes)." -ForegroundColor Yellow
        Write-Host "*** Los SKU con stock y sin precio NO se pueden cobrar en una PC nueva hasta cargarles precio." -ForegroundColor Yellow
        Write-Host "*** Esto NO se puede publicar así: release.ps1 sin -NoPublish vuelve a frenar acá.`n" -ForegroundColor Yellow
    } else {
        throw "La plantilla NO está lista para publicar (ver el detalle arriba). No fuerces la publicación sin resolver los bloqueantes."
    }
}
if ($AceptarBloqueantes -and -not $NoPublish) {
    throw "-AceptarBloqueantes solo vale junto con -NoPublish (no se publica una plantilla con bloqueantes)."
}

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
# Canal de actualizaciones = repo PUBLICO de código (los clientes ya apuntan ahí).
$releaseRepo = "shaman2527/Service_Tecnico"
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

# 7) Manifesto Drive (respaldo si GitHub está bloqueado - endpoint 2 del updater)
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

# 9) Publicacion (GitHub Release). Con -NoPublish NO se publica NADA.
if ($NoPublish) {
    Step "SIN PUBLICAR (-NoPublish)"
    Write-Host "No se publico NADA: ni release en GitHub, ni manifiesto para el updater." -ForegroundColor Yellow
    Write-Host "Los clientes siguen en su version actual (este instalador es solo para esta PC)." -ForegroundColor Yellow
    Write-Host "Instalador LOCAL: $setup" -ForegroundColor Green
} else {
    Step "GitHub Release v$Version (repo publico $releaseRepo)"
    gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        gh release create "v$Version" "$setup" "$sig" "src-tauri\target\release\bundle\nsis\latest.json" --repo $releaseRepo --title "Registro v$Version" --notes $Notes
        if ($LASTEXITCODE -ne 0) { throw "gh release create fallo (intenta: gh auth login)" }
        Write-Host "Release publicada en $releaseRepo. El endpoint del updater ya sirve latest.json." -ForegroundColor Green
    } else {
        Write-Host "gh no autenticado - la release NO se publico." -ForegroundColor Yellow
        $cmdManual = 'gh release create v' + $Version + ' "' + $setup + '" "' + $sig + '" src-tauri\target\release\bundle\nsis\latest.json --repo ' + $releaseRepo
        Write-Host "Paso manual: gh auth login  y luego:  $cmdManual" -ForegroundColor Yellow
    }
}

Write-Host "LISTO. Instalador en: instaladores\Registro Servicio Tecnico_${Version}_x64-setup.exe" -ForegroundColor Green
if ($NoPublish) {
    Write-Host "MODO LOCAL: no se publico nada. Ejecuta esa setup.exe en la PC que quieras actualizar." -ForegroundColor Yellow
}
Write-Host "Recordatorio: si GitHub esta bloqueado, sube latest_drive.json y el setup a Drive (misma carpeta, reemplazar archivos)." -ForegroundColor Green
