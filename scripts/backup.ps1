#Requires -Version 5.1
<#
.SYNOPSIS
    Nightly backup for a venue machine: a database dump plus the menu photos.

.DESCRIPTION
    Nothing else backs this install up. The database alone is not enough - menu
    photos live in UPLOAD_DIR, outside both the database and the release
    directories - so both are taken together.

    Run from Task Scheduler (WINDOWS_SETUP.md section 8). Exits non-zero on any
    failure so the task's "last run result" is worth looking at.

.PARAMETER MirrorTo
    A second location - another physical disk, or a USB drive - that the whole
    backup directory is copied to afterwards. A dump on the same drive as the
    database is not a backup.

.EXAMPLE
    .\backup.ps1 -MirrorTo E:\masadan-backups
#>
[CmdletBinding()]
param(
    [string]$EnvFile = "C:\masadan\env\masadan.env",
    [string]$BackupDir = "C:\masadan-data\backups",
    [string]$MirrorTo,
    [int]$KeepDays = 30
)

$ErrorActionPreference = "Stop"

function Info { param($m) Write-Host "[backup] $m" }
function Fail { param($m) Write-Host "[backup] $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $EnvFile)) { Fail "no env file at $EnvFile" }

# Same parsing as update.ps1, so one env file serves the app and both scripts.
$envVars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}
foreach ($key in @("DATABASE_URL", "UPLOAD_DIR")) {
    if (-not $envVars.ContainsKey($key)) { Fail "$EnvFile has no $key" }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMddTHHmm"
$dump = Join-Path $BackupDir "masadan-$stamp.dump"

# ----------------------------------------------------------------- database --

$dbUri = [uri]$envVars["DATABASE_URL"]
if (-not $dbUri.UserInfo) { Fail "DATABASE_URL has no user:password - cannot run pg_dump" }
$dbUser, $dbPass = $dbUri.UserInfo -split ":", 2
$env:PGPASSWORD = [uri]::UnescapeDataString($dbPass)
try {
    & pg_dump -Fc -h $dbUri.Host -p $dbUri.Port -U ([uri]::UnescapeDataString($dbUser)) `
        -d $dbUri.AbsolutePath.TrimStart("/") -f $dump
    if ($LASTEXITCODE -ne 0) { Fail "pg_dump failed ($LASTEXITCODE)" }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if (-not (Test-Path $dump) -or (Get-Item $dump).Length -eq 0) {
    Fail "dump is missing or empty"
}
Info "database -> $dump ($([Math]::Round((Get-Item $dump).Length / 1KB)) KB)"

# ------------------------------------------------------------------- photos --
# Copied, never mirrored with /MIR: a photo deleted by mistake in the admin
# panel must still be in the backup.

function Copy-Tree {
    param([string]$From, [string]$To)
    & robocopy $From $To /E /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
    # robocopy uses 0-7 for degrees of success; 8 and above are failures.
    if ($LASTEXITCODE -ge 8) { Fail "robocopy $From -> $To failed ($LASTEXITCODE)" }
}

$uploads = $envVars["UPLOAD_DIR"]
if (Test-Path $uploads) {
    Copy-Tree -From $uploads -To (Join-Path $BackupDir "uploads")
    Info "photos -> $(Join-Path $BackupDir 'uploads')"
} else {
    Info "no upload directory at $uploads yet - skipping photos"
}

# -------------------------------------------------------------------- prune --
# Only this script's nightly dumps. update.ps1's pre-update-*.dump files are
# rollback points and are left for a human to clear.

Get-ChildItem $BackupDir -Filter "masadan-*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    ForEach-Object {
        Info "removing $($_.Name) (older than $KeepDays days)"
        Remove-Item $_.FullName -Force
    }

# ------------------------------------------------------------------- mirror --

if ($MirrorTo) {
    if (-not (Test-Path (Split-Path $MirrorTo -Qualifier))) {
        Fail "mirror drive for $MirrorTo is not attached - the backup exists only on this disk"
    }
    Copy-Tree -From $BackupDir -To $MirrorTo
    Info "mirrored -> $MirrorTo"
} else {
    Info "no -MirrorTo given: this backup is on the same machine as the database"
}

Info "done"
