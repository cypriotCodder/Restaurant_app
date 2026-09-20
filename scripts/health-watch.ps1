#Requires -Version 5.1
<#
.SYNOPSIS
    Polls /api/health and restarts the app when it stops being healthy.

.DESCRIPTION
    NSSM restarts a process that CRASHED. It cannot see one that is up and
    broken - database unreachable, or the POS sweep silently stopped - and
    those are the failures that end with the kitchen not printing and nobody
    knowing. /api/health checks exactly those two things, which is what makes
    it worth polling.

    One run = one check. A Scheduled Task runs it every minute; the failure
    count lives in a small state file between runs, so a single blip does not
    restart anything mid-service.

        healthy            -> clear the counter, do nothing
        unhealthy x N      -> restart MasadanServer, alert, reset
        unreachable        -> counts the same as unhealthy

    Alerting is one HTTP POST to ntfy.sh (or anything that accepts a POST body)
    when AlertUrl is set. It needs the internet, which the venue may not have -
    that is accepted: the restart is the part that must work offline, the
    message is a courtesy.

.PARAMETER AlertUrl
    Optional. e.g. https://ntfy.sh/masadan-<something-unguessable>. Anyone who
    knows the URL can read the alerts, so make the topic random.

.PARAMETER Register
    Register as a Scheduled Task running every minute. Requires elevation.

.EXAMPLE
    .\health-watch.ps1 -AlertUrl https://ntfy.sh/masadan-7f3a9c -Register
#>
[CmdletBinding()]
param(
    [string]$HealthUrl = "http://127.0.0.1:3000/api/health",
    [string]$EnvFile = "C:\masadan\env\masadan.env",
    [string]$ServiceName = "MasadanServer",
    [string]$StateFile = "C:\masadan-data\logs\health-watch.state",
    [string]$AlertUrl = "",
    [int]$FailuresBeforeRestart = 3,
    [switch]$Register
)

$ErrorActionPreference = "Stop"

function Info { param($m) Write-Host "[health] $m" }

# Everything worth knowing about goes to the Windows event log as well as
# stdout: a Scheduled Task's console output is nobody's idea of a log.
function Write-Event {
    param([string]$Message, [string]$Level = "Information", [int]$Id = 1000)
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists("Masadan")) {
            New-EventLog -LogName Application -Source "Masadan"
        }
        Write-EventLog -LogName Application -Source "Masadan" -EntryType $Level -EventId $Id -Message $Message
    } catch {
        # Creating the source needs elevation the first time. Not worth failing
        # a health check over.
    }
}

function Send-Alert {
    param([string]$Message)
    Info $Message
    if (-not $AlertUrl) { return }
    try {
        Invoke-RestMethod -Uri $AlertUrl -Method Post -Body $Message -TimeoutSec 10 | Out-Null
    } catch {
        Info "alert could not be sent (no internet?): $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------- register ---

if ($Register) {
    $self = $MyInvocation.MyCommand.Path
    $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -HealthUrl `"$HealthUrl`" -EnvFile `"$EnvFile`" -ServiceName `"$ServiceName`" -StateFile `"$StateFile`" -FailuresBeforeRestart $FailuresBeforeRestart"
    if ($AlertUrl) { $argLine += " -AlertUrl `"$AlertUrl`"" }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName "MasadanHealthWatch" -Action $action -Trigger $trigger `
        -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

    Info "registered scheduled task 'MasadanHealthWatch', every minute"
    Info "prove it works: stop MasadanServer and wait $FailuresBeforeRestart minutes."
    exit 0
}

# ------------------------------------------------------------------ check ----

# The detailed body is gated behind CRON_SECRET; without it the endpoint still
# answers 200/503, which is all the restart decision needs. Read it when we can
# so the alert says WHAT is broken rather than just that something is.
$token = ""
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*CRON_SECRET\s*=\s*(.*)$') { $token = $Matches[1].Trim().Trim('"') }
    }
}

$headers = @{}
if ($token) { $headers["Authorization"] = "Bearer $token" }

$healthy = $false
$detail = ""
try {
    $res = Invoke-WebRequest -Uri $HealthUrl -Headers $headers -UseBasicParsing -TimeoutSec 10
    $healthy = ($res.StatusCode -eq 200)
    $detail = $res.Content
} catch {
    # A 503 arrives here as an exception too, and its body is the useful part.
    $detail = $_.Exception.Message
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } catch { }
}

New-Item -ItemType Directory -Force -Path (Split-Path $StateFile) | Out-Null
$failures = 0
if (Test-Path $StateFile) { $failures = [int](Get-Content $StateFile -Raw).Trim() }

if ($healthy) {
    if ($failures -gt 0) {
        Send-Alert "Masadan: healthy again after $failures failed check(s)."
        Write-Event "Health recovered after $failures failed checks." "Information" 1001
    }
    Set-Content -Path $StateFile -Value "0"
    Info "ok"
    exit 0
}

$failures++
Set-Content -Path $StateFile -Value "$failures"
$short = ($detail -replace '\s+', ' ').Trim()
if ($short.Length -gt 300) { $short = $short.Substring(0, 300) }
Info "unhealthy ($failures/$FailuresBeforeRestart): $short"
Write-Event "Health check failed ($failures/$FailuresBeforeRestart): $short" "Warning" 1002

if ($failures -lt $FailuresBeforeRestart) { exit 0 }

# Past the threshold, restart on the threshold itself and then only every 10th
# check. Restarting every minute all evening neither fixes a broken database
# nor lets anyone read the logs of why it broke.
if ((($failures - $FailuresBeforeRestart) % 10) -ne 0) {
    Info "still unhealthy ($failures checks); holding off - a human is needed"
    exit 1
}

# ---------------------------------------------------------------- restart ----

Send-Alert "Masadan: $FailuresBeforeRestart failed health checks, restarting $ServiceName. Last: $short"
Write-Event "Restarting $ServiceName after $failures failed health checks. Last: $short" "Error" 1003

try {
    Restart-Service $ServiceName -Force
    Start-Sleep -Seconds 15
    $after = Invoke-WebRequest -Uri $HealthUrl -Headers $headers -UseBasicParsing -TimeoutSec 15
    if ($after.StatusCode -eq 200) {
        Send-Alert "Masadan: back up after a restart."
        Set-Content -Path $StateFile -Value "0"
        exit 0
    }
} catch {
    # Fall through: the restart did not fix it, which is the message that matters.
}

# Do not reset the counter here. A venue that needs a human should keep saying
# so rather than restarting in a loop every three minutes all evening.
Send-Alert "Masadan: STILL DOWN after restarting $ServiceName. This needs someone at the machine."
Write-Event "Still unhealthy after restarting $ServiceName." "Error" 1004
exit 1
