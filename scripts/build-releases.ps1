<#
.SYNOPSIS
    Genera el instalador nativo oficial de Windows x64 para DiskVault Finder:
      1. Verifica TypeScript y ejecuta pruebas unitarias de Rust
      2. Compila el instalador nativo NSIS (.exe) que instala la app en Windows y permite actualizar conservando tus datos
      3. Genera SHA256SUMS.txt

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build-releases.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TauriDir = Join-Path $RepoRoot "src-tauri"
$ReleaseDir = Join-Path $RepoRoot "release"
$TauriConfPath = Join-Path $TauriDir "tauri.conf.json"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "No se encontró el comando requerido '$Name' en el PATH. Instálalo antes de compilar."
    }
}

Push-Location $RepoRoot
try {
    Write-Step "Verificando herramientas de compilación..."
    Assert-Command "node"
    Assert-Command "npm"
    Assert-Command "cargo"
    Assert-Command "rustc"

    $TauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json
    $Version = $TauriConf.version
    if (-not $Version) {
        $Version = "1.0.0"
    }

    Write-Host "Producto : $($TauriConf.productName) (Instalación Nativa Windows x64)"
    Write-Host "Versión  : $Version"
    Write-Host "Destino  : $ReleaseDir"

    if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
        Write-Step "Instalando dependencias de frontend (npm install)..."
        npm install
        if ($LASTEXITCODE -ne 0) { throw "Falló npm install." }
    }

    if (-not $SkipTests) {
        Write-Step "Verificando tipos TypeScript (npx tsc --noEmit)..."
        npx tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw "Falló la verificación de tipos TypeScript." }

        Write-Step "Ejecutando pruebas unitarias de Rust (cargo test)..."
        Push-Location $TauriDir
        try {
            cargo test
            if ($LASTEXITCODE -ne 0) { throw "Fallaron las pruebas unitarias de Rust." }
        } finally {
            Pop-Location
        }
    }

    Write-Step "Compilando instalador nativo de Windows x64 (NSIS .exe)..."
    npx --yes @tauri-apps/cli@2 build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Falló tauri build." }

    # Preparar carpeta release/
    if (Test-Path $ReleaseDir) {
        Remove-Item -Path $ReleaseDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

    $TargetReleaseDir = Join-Path $TauriDir "target\release"
    $NsisDir = Join-Path $TargetReleaseDir "bundle\nsis"
    $NsisExe = Get-ChildItem -Path $NsisDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $NsisExe) {
        throw "No se encontró el instalador NSIS (.exe) en '$NsisDir'."
    }

    $FinalInstallerName = "DiskVault-Finder-$Version-x64-setup.exe"
    $FinalInstallerPath = Join-Path $ReleaseDir $FinalInstallerName
    Copy-Item -Path $NsisExe.FullName -Destination $FinalInstallerPath -Force

    # Calcular hash SHA-256
    Write-Step "Generando SHA256SUMS.txt..."
    $hash = (Get-FileHash -Path $FinalInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -Path (Join-Path $ReleaseDir "SHA256SUMS.txt") -Value "$hash  $FinalInstallerName" -Encoding UTF8

    $sizeMB = [Math]::Round((Get-Item $FinalInstallerPath).Length / 1MB, 2)
    Write-Host ""
    Write-Host "Instalador nativo generado correctamente en: $ReleaseDir" -ForegroundColor Green
    Write-Host "------------------------------------------------------------"
    Write-Host ("  - {0} ({1} MB)" -f $FinalInstallerName, $sizeMB)
    Write-Host "  - SHA256SUMS.txt"
    Write-Host "------------------------------------------------------------"
}
finally {
    Pop-Location
}
