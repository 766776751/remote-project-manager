# launcher.ps1
# Find or auto-deploy Node.js, then run lib/server.js.
# All complex logic lives here (PowerShell 5.1 compatible, no PS7-only syntax).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$port = 5000

# 1) Port check
$occupied = $false
try {
    $lines = netstat -ano 2>$null | Select-String ":$port "
    foreach ($l in $lines) {
        if ($l -match 'LISTENING') { $occupied = $true }
    }
} catch {}
if ($occupied) {
    Write-Host "[WARN] Port $port is already in use. Close the other instance (node.exe) or reboot, then re-run." -ForegroundColor Yellow
    exit 1
}

# 2) Find node
$node = $null
$candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LocalAppData\Programs\nodejs\node.exe",
    "$root\node-runtime\node.exe",
    "C:\Users\LQ\.workbuddy\binaries\node\versions\22.22.2\node.exe"
)
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $candidates = @($cmd.Source) + $candidates }
foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { $node = $c; break }
}

# 3) If not found, download + deploy official Node
if (-not $node) {
    Write-Host '[info] No compatible Node.js found. Downloading and deploying...' -ForegroundColor Cyan
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    try {
        $j = Invoke-RestMethod https://nodejs.org/dist/index.json
    } catch {
        Write-Host '[error] Cannot fetch Node version (no network?). Install Node.js >= 22.5 manually: https://nodejs.org' -ForegroundColor Red
        exit 1
    }
    $v = ($j | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
    if (-not $v) { $v = $j[0].version }
    $url = "https://nodejs.org/dist/$v/node-$v-win-$arch.zip"
    $zip = "$env:TEMP\node-$v-win-$arch.zip"
    Write-Host "[info] Downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    } catch {
        Write-Host '[error] Download failed (check network).' -ForegroundColor Red
        exit 1
    }
    $out = "$root\node-runtime"
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    try {
        Expand-Archive -Force $zip -DestinationPath $out
    } catch {
        Write-Host '[error] Extraction failed.' -ForegroundColor Red
        exit 1
    }
    Remove-Item $zip -Force
    $found = Get-ChildItem -Path $out -Recurse -Filter node.exe | Select-Object -First 1
    if (-not $found) {
        Write-Host '[error] node.exe not found after extraction.' -ForegroundColor Red
        exit 1
    }
    $node = $found.FullName
    Write-Host "[info] Node runtime deployed: $node" -ForegroundColor Green
}

Write-Host "[info] Using Node.js: $node"
& $node --version
Write-Host '============================================================'
Write-Host "[info] Starting service on port $port ..."
Write-Host "        Local browser:  http://localhost:$port"
Write-Host '        (Close this window to stop the service)'
Write-Host '============================================================'
& $node ([System.IO.Path]::Combine($root, 'lib', 'server.js'))
