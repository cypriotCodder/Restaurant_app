#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Restarts the app when /api/health says it is up but broken.

.DESCRIPTION
    The service manager brings back a process that crashed. It cannot see one
    that is running and not working - the POS sweep stopped, or the database
    connection gone bad - which is the failure that ends with the kitchen not
    printing and nobody knowing.

    Run every minute from Task Scheduler (WINDOWS_SETUP.md section 9). A single
    failed probe is not acted on: the app answers 503 for a moment while it
    boots, and restarting it for that would loop forever.
#>
[CmdletBinding()]
param(
    [string]$HealthUrl = "http://127.0.0.1:3000/api/health",
    [string]$Service = "MasadanServer",
    [int]$Attempts = 3,
    [int]$DelaySec = 10,
    [string]$LogFile = "C:\masadan-data\logs\watchdog.log"
)

$ErrorActionPreference = "Stop"

function Test-Health {
    try {
        $res = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 5 -UseBasicParsing
        return $res.StatusCode -eq 200
    } catch {
        # A 503 lands here too: Invoke-WebRequest throws on non-2xx.
        return $false
    }
}

for ($i = 1; $i -le $Attempts; $i++) {
    if (Test-Health) { exit 0 }
    if ($i -lt $Attempts) { Start-Sleep -Seconds $DelaySec }
}

# Stopped on purpose (an update in progress, or someone working on it): leave it.
$svc = Get-Service $Service -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne "Running") { exit 0 }

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
Add-Content $LogFile "$(Get-Date -Format s) health failed $Attempts times - restarting $Service"
Restart-Service $Service -Force
