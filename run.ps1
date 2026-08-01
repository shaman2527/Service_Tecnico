param(
    [switch]$Dev,
    [switch]$Build
)

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

if ($Build) {
    Write-Host "Building frontend..." -ForegroundColor Cyan
    npm run build

    Write-Host "Building Tauri app (release)..." -ForegroundColor Cyan
    Set-Location "$ProjectDir\src-tauri"
    cargo build --release

    # Copy DB next to binary
    Copy-Item "$ProjectDir\registro.db" "target\release\registro.db" -Force
    Copy-Item "target\release\registro.exe" "$ProjectDir\Registro.exe" -Force

    Set-Location $ProjectDir
    Write-Host "Done! Binary at: $ProjectDir\Registro.exe" -ForegroundColor Green
    return
}

if ($Dev) {
    Write-Host "Starting dev mode..." -ForegroundColor Cyan
    npx tauri dev
    return
}

# Run the release binary (standalone, no Vite needed)
$Binary = "$ProjectDir\Registro.exe"
if (-not (Test-Path $Binary)) {
    $Binary = "$ProjectDir\src-tauri\target\release\registro.exe"
}
if (-not (Test-Path $Binary)) {
    $Binary = "$ProjectDir\src-tauri\target\debug\registro.exe"
}

if (Test-Path $Binary) {
    # Ensure DB is next to the binary
    $BinDir = Split-Path $Binary -Parent
    if (-not (Test-Path "$BinDir\registro.db") -and (Test-Path "$ProjectDir\registro.db")) {
        Copy-Item "$ProjectDir\registro.db" "$BinDir\registro.db" -Force
    }
    Write-Host "Launching Registro..." -ForegroundColor Cyan
    Start-Process -FilePath $Binary -WorkingDirectory $BinDir
} else {
    Write-Host "No binary found. Run: .\run.ps1 -Build" -ForegroundColor Red
}
