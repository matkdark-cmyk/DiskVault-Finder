<#
.SYNOPSIS
    Genera el paquete oficial Portable (.zip) para Windows x64 de DiskVault Finder:
      1. Compila el ejecutable Windows x64 sin crear instalador (--no-bundle)
      2. Empaqueta DiskVault-Finder-<version>-x64-portable.zip con portable.flag y LEEME-PORTABLE.txt
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

    Write-Host "Producto : $($TauriConf.productName) (Edición Portable)"
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

    Write-Step "Compilando ejecutable portable de Windows x64 (sin instalador)..."
    npx --yes @tauri-apps/cli@2 build --no-bundle
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

    # Ensamblar paquete Portable (.zip) con portable.flag
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

    # Limpiar carpeta temporal de staging
    Remove-Item -Path $PortableStagingDir -Recurse -Force

    # Calcular hash SHA-256
    Write-Step "Generando SHA256SUMS.txt..."
    $hash = (Get-FileHash -Path $FinalPortableZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -Path (Join-Path $ReleaseDir "SHA256SUMS.txt") -Value "$hash  $FinalPortableZipName" -Encoding UTF8

    $sizeMB = [Math]::Round((Get-Item $FinalPortableZipPath).Length / 1MB, 2)
    Write-Host ""
    Write-Host "Paquete portable generado correctamente en: $ReleaseDir" -ForegroundColor Green
    Write-Host "------------------------------------------------------------"
    Write-Host ("  - {0} ({1} MB)" -f $FinalPortableZipName, $sizeMB)
    Write-Host "  - SHA256SUMS.txt"
    Write-Host "------------------------------------------------------------"
}
finally {
    Pop-Location
}
