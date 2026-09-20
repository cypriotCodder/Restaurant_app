#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Registers the three venue processes as Windows services so they survive a
    reboot.

.DESCRIPTION
    The walkthrough leaves the app, the print shim and the bridge agent running
    in three terminal windows. That is fine for a printer test and unacceptable
    for service: the first power cut ends with a restaurant that cannot take
    orders and no one knowing why.

    Three services, matching the names scripts\update.ps1 already stops and
    starts:

        MasadanServer   node C:\masadan\current\server.js
        MasadanShim     node C:\masadan\current\bridge\win-usb-print.mjs
        MasadanAgent    node C:\masadan\current\bridge\agent.mjs

    They run against C:\masadan\current - the junction, not a release directory
    - so an update swaps the target underneath them and the service definitions
    never need touching.

    Environment comes from the env file, never from the service definitions, so
    secrets live in exactly one ACL'd place and a rotation is an edit plus a
    restart.

    !! THE SHIM IS THE AWKWARD ONE. A service running as LocalSystem lives in
    session 0 and generally cannot resolve a per-user printer connection like
    \\localhost\KITCHEN. Pass -ShimUser (and -ShimPassword) to run it as the
    till's own account, which can. Print a ticket after a reboot before you
    believe any of this works.

    Uses NSSM (https://nssm.cc), which is the least painful way to run a
    console program as a Windows service: it owns the child process, restarts
    it on exit, and redirects stdout/stderr to a file that rotates.

.PARAMETER NssmPath
    nssm.exe. Download it, unzip it, and point this at win64\nssm.exe.

.PARAMETER ShimUser
    Account for the shim service, e.g. "VENUE-PC\till". Omit at your peril -
    see above. Use -ShimPassword, or you are prompted.

.EXAMPLE
    .\install-services.ps1 -NssmPath C:\tools\nssm.exe -ShimUser VENUE-PC\till

.EXAMPLE
    # What would change, without changing it.
    .\install-services.ps1 -NssmPath C:\tools\nssm.exe -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$NssmPath,
    [string]$Root = "C:\masadan",
    [string]$EnvFile = "C:\masadan\env\masadan.env",
    [string]$LogDir = "C:\masadan-data\logs",
    [string]$NodePath = "",
    [string]$ShimUser = "",
    [string]$ShimPassword = ""
)

$ErrorActionPreference = "Stop"

function Info { param($m) Write-Host "[services] $m" }
function Warn { param($m) Write-Host "[services] $m" -ForegroundColor Yellow }
function Fail { param($m) Write-Host "[services] $m" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- preflight --

if (-not (Test-Path $NssmPath)) { Fail "no nssm.exe at $NssmPath - download it from nssm.cc" }
if (-not (Test-Path $EnvFile))  { Fail "no env file at $EnvFile - create it before registering services" }

$currentLink = Join-Path $Root "current"
if (-not (Test-Path $currentLink)) {
    Fail "no $currentLink junction. Deploy a release with update.ps1 first; services point at the junction, not at a release."
}

foreach ($f in @("server.js", "bridge\win-usb-print.mjs", "bridge\agent.mjs")) {
    if (-not (Test-Path (Join-Path $currentLink $f))) { Fail "$currentLink\$f is missing - is this a full bundle?" }
}

if (-not $NodePath) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail "node is not on PATH - install Node 24 LTS or pass -NodePath" }
    $NodePath = $node.Source
}
Info "node: $NodePath"

# The env file is the single source of configuration. Parsed the same way
# update.ps1 parses it, so the two never disagree about what a line means.
$envVars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}
foreach ($key in @("DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "NEXT_PUBLIC_BASE_URL", "UPLOAD_DIR")) {
    if (-not $envVars.ContainsKey($key)) { Fail "$EnvFile has no $key" }
}
if ($envVars["NEXT_PUBLIC_BASE_URL"] -match "localhost|127\.0\.0\.1") {
    Warn "NEXT_PUBLIC_BASE_URL is a local address. Every QR code will encode it. Do not print table cards until this is the real hostname."
}
foreach ($key in @("PRINTER_SHARE", "BRIDGE_KEY")) {
    if (-not $envVars.ContainsKey($key)) { Warn "$EnvFile has no $key - the shim or the agent will not work without it" }
}

if ($ShimUser -and -not $ShimPassword) {
    $secure = Read-Host "Password for $ShimUser" -AsSecureString
    $ShimPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $ShimUser) {
    Warn "no -ShimUser: MasadanShim will run as LocalSystem and probably cannot reach $($envVars['PRINTER_SHARE'])."
    Warn "Register it anyway if you like, but test printing after a reboot before opening."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ----------------------------------------------------------------- install ---

function Invoke-Nssm {
    param([string[]]$NssmArgs)
    & $NssmPath @NssmArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "nssm $($NssmArgs -join ' ') failed ($LASTEXITCODE)" }
}

function Install-VenueService {
    param(
        [string]$Name,
        [string]$Script,
        [string]$Description,
        [string]$RunAsUser = "",
        [string]$RunAsPassword = ""
    )

    if (-not $PSCmdlet.ShouldProcess($Name, "register service")) { return }

    if (Get-Service $Name -ErrorAction SilentlyContinue) {
        Info "$Name exists - stopping and reconfiguring"
        Stop-Service $Name -Force -ErrorAction SilentlyContinue
        Invoke-Nssm @("remove", $Name, "confirm")
        Start-Sleep -Seconds 1
    }

    Info "registering $Name"
    Invoke-Nssm @("install", $Name, $NodePath, (Join-Path $currentLink $Script))
    Invoke-Nssm @("set", $Name, "AppDirectory", $currentLink)
    Invoke-Nssm @("set", $Name, "Description", $Description)
    Invoke-Nssm @("set", $Name, "Start", "SERVICE_AUTO_START")

    # Environment, one KEY=VALUE per line. NSSM wants them NUL-separated, which
    # in PowerShell is what a multi-line string becomes when passed through.
    $envBlock = ($envVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
    Invoke-Nssm @("set", $Name, "AppEnvironmentExtra", $envBlock)

    # Crash handling: come back, but back off, so a service that cannot start
    # does not spin the disk all night.
    Invoke-Nssm @("set", $Name, "AppExit", "Default", "Restart")
    Invoke-Nssm @("set", $Name, "AppRestartDelay", "5000")
    Invoke-Nssm @("set", $Name, "AppThrottle", "10000")

    # stdout and stderr to one rotating file each. Without this the logs go
    # nowhere and a failure at 21:00 is unexplainable at 09:00.
    Invoke-Nssm @("set", $Name, "AppStdout", (Join-Path $LogDir "$Name.log"))
    Invoke-Nssm @("set", $Name, "AppStderr", (Join-Path $LogDir "$Name.err.log"))
    Invoke-Nssm @("set", $Name, "AppRotateFiles", "1")
    Invoke-Nssm @("set", $Name, "AppRotateOnline", "1")
    Invoke-Nssm @("set", $Name, "AppRotateBytes", "10485760")

    if ($RunAsUser) {
        Info "$Name runs as $RunAsUser"
        Invoke-Nssm @("set", $Name, "ObjectName", $RunAsUser, $RunAsPassword)
    }
}

Install-VenueService -Name "MasadanServer" -Script "server.js" `
    -Description "Masadan ordering server (Next.js standalone)"

Install-VenueService -Name "MasadanShim" -Script "bridge\win-usb-print.mjs" `
    -Description "Masadan USB print shim: TCP 9100 to the shared Windows printer queue" `
    -RunAsUser $ShimUser -RunAsPassword $ShimPassword

Install-VenueService -Name "MasadanAgent" -Script "bridge\agent.mjs" `
    -Description "Masadan bridge agent: polls the outbox and prints kitchen tickets"

# ------------------------------------------------------------------- start ---

if (-not $PSCmdlet.ShouldProcess($Root, "start services")) {
    Info "-WhatIf: nothing was registered or started"
    exit 0
}

# Order matters on a cold start: the agent gives up on a socket that is not
# listening, and the shim is what listens.
foreach ($svc in @("MasadanServer", "MasadanShim", "MasadanAgent")) {
    Info "starting $svc"
    Start-Service $svc
    Start-Sleep -Seconds 2
}

# Loopback, deliberately: this checks that the SERVICE is up, not that the
# hostname, certificate and reverse proxy in front of it are right.
$health = "http://127.0.0.1:$(if ($envVars.ContainsKey('PORT')) { $envVars['PORT'] } else { '3000' })/api/health"
Info "waiting for $health"
$ok = $false
foreach ($i in 1..30) {
    try {
        $res = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 5
        if ($res.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}

Get-Service MasadanServer, MasadanShim, MasadanAgent | Format-Table Name, Status, StartType

if (-not $ok) {
    Warn "the app did not report healthy within 60s. Check $LogDir\MasadanServer.err.log"
    exit 1
}

Info "all three services are running and the app is healthy."
Warn "NOT YET PROVEN: printing from a service. Reboot the machine, log in to nothing, place an order, accept it, and watch for paper."
