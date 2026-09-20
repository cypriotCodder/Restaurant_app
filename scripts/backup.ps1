#Requires -Version 5.1
<#
.SYNOPSIS
    Daily backup of the venue's database and menu photos.

.DESCRIPTION
    Two things have to be caught, and only one of them is in the database:

        1. Postgres  - orders, bills, staff, menu, table QR secrets.
        2. UPLOAD_DIR - the menu photos. They live outside the app directory
                        and nothing in the database contains their bytes.

    A dump without the photos restores a menu with holes in it.

    Runs pg_dump on the host if it is there, and otherwise inside the Postgres
    container - the venue installs Postgres via Docker, so the host usually has
    no client tools at all.

    Old backups are pruned by age. Both files for a day go or stay together, so
    a surviving dump always has its photos.

.PARAMETER Destination
    Where backups are written. Make this a DIFFERENT PHYSICAL DISK from the
    one Postgres is on. A backup on the disk that dies with the machine is a
    copy, not a backup.

.PARAMETER Register
    Register this script as a daily Scheduled Task instead of running it.
    Requires an elevated shell.

.EXAMPLE
    .\backup.ps1 -Destination E:\masadan-backups

.EXAMPLE
    # Run it every day at 04:00, as SYSTEM.
    .\backup.ps1 -Destination E:\masadan-backups -Register
#>
[CmdletBinding()]
param(
    [string]$Destination = "C:\masadan-data\backups",
    [string]$EnvFile = "C:\masadan\env\masadan.env",
    [string]$ContainerName = "masadan-db-1",
    [int]$KeepDays = 30,
    [switch]$Register
)

$ErrorActionPreference = "Stop"

function Info { param($m) Write-Host "[backup] $m" }
function Warn { param($m) Write-Host "[backup] $m" -ForegroundColor Yellow }
function Fail { param($m) Write-Host "[backup] $m" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- register ---

if ($Register) {
    $self = $MyInvocation.MyCommand.Path
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -Destination `"$Destination`" -EnvFile `"$EnvFile`" -ContainerName `"$ContainerName`" -KeepDays $KeepDays"
    $trigger = New-ScheduledTaskTrigger -Daily -At 4am
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName "MasadanBackup" -Action $action -Trigger $trigger `
        -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
    Info "registered scheduled task 'MasadanBackup', daily at 04:00"
    Info "run it once now to prove it works:  Start-ScheduledTask -TaskName MasadanBackup"
    exit 0
}

# --------------------------------------------------------------- preflight ---

if (-not (Test-Path $EnvFile)) { Fail "no env file at $EnvFile" }

$envVars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}
foreach ($key in @("DATABASE_URL", "UPLOAD_DIR")) {
    if (-not $envVars.ContainsKey($key)) { Fail "$EnvFile has no $key" }
}

$dbUri = [uri]$envVars["DATABASE_URL"]
if (-not $dbUri.UserInfo) { Fail "DATABASE_URL has no user:password - cannot run pg_dump" }
$dbUser, $dbPass = $dbUri.UserInfo -split ":", 2
$dbUser = [uri]::UnescapeDataString($dbUser)
$dbPass = [uri]::UnescapeDataString($dbPass)
$dbName = $dbUri.AbsolutePath.TrimStart("/")

$uploadDir = $envVars["UPLOAD_DIR"]
if (-not (Test-Path $uploadDir)) { Warn "UPLOAD_DIR $uploadDir does not exist - no photos will be backed up" }

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$stamp = Get-Date -Format "yyyyMMddTHHmm"
$dump = Join-Path $Destination "masadan-$stamp.dump"
$photos = Join-Path $Destination "uploads-$stamp.zip"

# -------------------------------------------------------------- the database -

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue

if ($pgDump) {
    Info "dumping $dbName with the host pg_dump"
    $env:PGPASSWORD = $dbPass
    try {
        & pg_dump -Fc -h $dbUri.Host -p $dbUri.Port -U $dbUser -d $dbName -f $dump
        if ($LASTEXITCODE -ne 0) { Fail "pg_dump failed ($LASTEXITCODE)" }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
} else {
    # No client tools on the host: dump inside the container the database is
    # already running in, and stream it out. -Fc is a binary format, so the
    # redirect has to be byte-exact - PowerShell's > would corrupt it by
    # re-encoding as text.
    Info "no host pg_dump; dumping inside container $ContainerName"
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { Fail "neither pg_dump nor docker is available - cannot back up" }

    $running = & docker ps --filter "name=$ContainerName" --format "{{.Names}}"
    if (-not $running) { Fail "container $ContainerName is not running (docker ps). Pass -ContainerName if it is called something else." }

    & cmd /c "docker exec -e PGPASSWORD=$dbPass $ContainerName pg_dump -Fc -U $dbUser -d $dbName > `"$dump`""
    if ($LASTEXITCODE -ne 0) { Fail "containerised pg_dump failed ($LASTEXITCODE)" }
}

if (-not (Test-Path $dump) -or (Get-Item $dump).Length -eq 0) {
    Fail "dump is missing or empty - treat this run as failed"
}
Info "database: $dump ($([math]::Round((Get-Item $dump).Length / 1MB, 1)) MB)"

# ----------------------------------------------------------------- photos ----

if (Test-Path $uploadDir) {
    Info "archiving $uploadDir"
    Compress-Archive -Path (Join-Path $uploadDir "*") -DestinationPath $photos -Force -ErrorAction SilentlyContinue
    if (Test-Path $photos) {
        Info "photos:   $photos ($([math]::Round((Get-Item $photos).Length / 1MB, 1)) MB)"
    } else {
        Warn "no photo archive was produced - UPLOAD_DIR may simply be empty"
    }
}

# ------------------------------------------------------------------ prune ----

$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem $Destination -File |
    Where-Object { $_.Name -match '^(masadan|uploads)-\d{8}T\d{4}\.(dump|zip)$' -and $_.LastWriteTime -lt $cutoff }
foreach ($f in $old) {
    Info "pruning $($f.Name)"
    Remove-Item $f.FullName -Force
}

Info "done. Keeping $KeepDays days."
Warn "An untested backup is a guess: restore one into a scratch database before you need it."
