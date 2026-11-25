<#
.SYNOPSIS
    Genera los artefactos oficiales de distribución para Windows x64 de DiskVault Finder:
      1. Instalador Windows NSIS (.exe)
      2. Paquete Portable (.zip) con portable.flag (cero entradas en el Registro de Windows)
      3. Archivo de verificación SHA256SUMS.txt

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

    Write-Host "Producto : $($TauriConf.productName)"
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

    Write-Step "Compilando aplicación y generando instalador NSIS (.exe)..."
    npx --yes @tauri-apps/cli build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "Falló tauri build." }

    # Preparar carpeta release/
    if (Test-Path $ReleaseDir) {
        Remove-Item -Path $ReleaseDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

    $TargetReleaseDir = Join-Path $TauriDir "target\release"
    $MainExePath = Join-Path $TargetReleaseDir "diskvault-finder.exe"
    if (-not (Test-Path $MainExePath)) {
        throw "No se encontró el ejecutable compilado en '$MainExePath'."
    }

    # 1. Copiar instalador NSIS (.exe)
    $NsisDir = Join-Path $TargetReleaseDir "bundle\nsis"
    $NsisExe = Get-ChildItem -Path $NsisDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $NsisExe) {
        throw "No se encontró el instalador NSIS (.exe) en '$NsisDir'."
    }

    $FinalInstallerName = "DiskVault-Finder-$Version-x64-setup.exe"
    $FinalInstallerPath = Join-Path $ReleaseDir $FinalInstallerName
    Copy-Item -Path $NsisExe.FullName -Destination $FinalInstallerPath -Force

    # 2. Ensamblar paquete Portable (.zip) con portable.flag
    Write-Step "Ensamblando versión Portable (.zip)..."
    $PortableFolderName = "DiskVault-Finder-$Version-x64-portable"
    $PortableStagingDir = Join-Path $ReleaseDir $PortableFolderName
    New-Item -ItemType Directory -Path $PortableStagingDir -Force | Out-Null

    Copy-Item -Path $MainExePath -Destination (Join-Path $PortableStagingDir "DiskVault Finder.exe") -Force
    Set-Content -Path (Join-Path $PortableStagingDir "portable.flag") -Value "DiskVault Finder Portable Mode - No eliminar este archivo" -Encoding UTF8

    $ReadmePortable = @"
DiskVault Finder $Version - Edición Portable (Windows x64)
============================================================

Cómo usar esta edición portable:
1. Descomprime esta carpeta en cualquier ubicación (USB, disco secundario o Escritorio).
2. Ejecuta "DiskVault Finder.exe".
3. El archivo "portable.flag" junto al ejecutable activa automáticamente el Modo Portable:
   - Toda la base de datos SQLite FTS5 y los ajustes se guardan en .\data\finder.db
   - No escribe nada en %APPDATA% ni en el Registro de Windows.
   - Puedes mover esta carpeta a otro PC llevando contigo tu caché indexado.

Requisito del sistema:
- Windows 10 (1903+) o Windows 11 (64 bits) con Microsoft Edge WebView2 Runtime.
"@
    Set-Content -Path (Join-Path $PortableStagingDir "LEEME-PORTABLE.txt") -Value $ReadmePortable -Encoding UTF8

    $FinalPortableZipName = "$PortableFolderName.zip"
    $FinalPortableZipPath = Join-Path $ReleaseDir $FinalPortableZipName
    Compress-Archive -Path "$PortableStagingDir\*" -DestinationPath $FinalPortableZipPath -CompressionLevel Optimal -Force

    # Limpiar carpeta temporal de staging dejando los dos artefactos finales + checksums
    Remove-Item -Path $PortableStagingDir -Recurse -Force

    # 3. Calcular hashes SHA-256
    Write-Step "Generando SHA256SUMS.txt..."
    $Artifacts = @($FinalInstallerPath, $FinalPortableZipPath)
    $HashLines = @()
    foreach ($file in $Artifacts) {
        $hash = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLowerInvariant()
        $fileName = Split-Path $file -Leaf
        $HashLines += "$hash  $fileName"
    }
    Set-Content -Path (Join-Path $ReleaseDir "SHA256SUMS.txt") -Value $HashLines -Encoding UTF8

    Write-Host ""
    Write-Host "Empaquetado completado correctamente en: $ReleaseDir" -ForegroundColor Green
    Write-Host "------------------------------------------------------------"
    foreach ($file in $Artifacts) {
        $sizeMB = [Math]::Round((Get-Item $file).Length / 1MB, 2)
        Write-Host ("  - {0} ({1} MB)" -f (Split-Path $file -Leaf), $sizeMB)
    }
    Write-Host "  - SHA256SUMS.txt"
    Write-Host "------------------------------------------------------------"
}
finally {
    Pop-Location
}
