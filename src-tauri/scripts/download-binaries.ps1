param (
    [string]$BinaryName
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinariesDir = Join-Path $ScriptDir "..\binaries"
if (-not (Test-Path $BinariesDir)) {
    New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
}

$Repo = "heyhuynhgiabuu/CLIProxyAPI"
# Fetch latest version or fallback
try {
    $LatestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
    $Version = $LatestRelease.tag_name -replace "^v", ""
} catch {
    Write-Warning "Failed to fetch latest verison: $_"
    $Version = "6.6.56-patched"
}

if ([string]::IsNullOrEmpty($Version)) {
    $Version = "6.6.56-patched"
}

# Determine Asset and ArchiveType based on BinaryName
$AssetName = ""

if ($BinaryName -match "x86_64-pc-windows-msvc") {
    $AssetName = "CLIProxyAPI_${Version}_windows_amd64.zip"
} elseif ($BinaryName -match "aarch64-pc-windows-msvc") {
    $AssetName = "CLIProxyAPI_${Version}_windows_arm64.zip"
} else {
    Write-Warning "Unknown target or not supported in this PS script: $BinaryName"
    exit 1
}

$Url = "https://github.com/$Repo/releases/download/v$Version/$AssetName"
Write-Host "Downloading $AssetName for $BinaryName..."
Write-Host "URL: $Url"

$TempDir = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    $ZipPath = Join-Path $TempDir $AssetName
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath

    Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

    $SourceExe = Join-Path $TempDir "CLIProxyAPI.exe"
    $DestPath = Join-Path $BinariesDir $BinaryName

    if (Test-Path $SourceExe) {
        Copy-Item -Path $SourceExe -Destination $DestPath -Force
        Write-Host "Downloaded to $DestPath"
    } else {
        Write-Error "Binary not found in archive."
        exit 1
    }
} catch {
    Write-Error "Failed to download or extract: $_"
    exit 1
} finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
