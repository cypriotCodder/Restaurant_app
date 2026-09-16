#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Applies a new release to a venue machine, with a backup and an automatic
    rollback if the new build does not come up healthy.

.DESCRIPTION
    Releases live side by side and a directory junction decides which one is
    live, so going back is the same operation as going forward:

        C:\masadan\
          releases\0.1.0+a1b2c3-20260915T1030\
          releases\0.1.0+d4e5f6-20260922T0400\
          current  -> junction to one of them
          env\masadan.env          (outside releases, survives updates)

    The app is never updated in place. Windows will not replace a directory
    that a running process holds handles on, and an interrupted in-place copy
    leaves a venue with no working install at all.

    Run this when the venue is CLOSED. It stops the services.

.PARAMETER BundlePath
    An extracted standalone bundle - the .next/standalone directory produced by
    `npm run package` on a build machine, copied here.

.EXAMPLE
    .\update.ps1 -BundlePath C:\incoming\standalone

.EXAMPLE
    # Look before you leap: validates and reports, changes nothing.
    .\update.ps1 -BundlePath C:\incoming\standalone -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$BundlePath,
    [string]$Root = "C:\masadan",
    [string]$EnvFile = "C:\masadan\env\masadan.env",
    [string]$BackupDir = "C:\masadan-data\backups",
    [string]$HealthUrl = "http://127.0.0.1:3000/api/health",
    [string[]]$Services = @("MasadanServer", "MasadanShim", "MasadanAgent"),
    [int]$HealthTimeoutSec = 90,
    [int]$KeepReleases = 3,
    [string]$PrismaVersion = "6.19.3",
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

function Info  { param($m) Write-Host "[update] $m" }
function Warn  { param($m) Write-Host "[update] $m" -ForegroundColor Yellow }
function Fail  { param($m) Write-Host "[update] $m" -ForegroundColor Red; exit 1 }

$releasesDir = Join-Path $Root "releases"
$currentLink = Join-Path $Root "current"

# ---------------------------------------------------------------- preflight --
# Everything that can be checked before anything is touched, is. A failure here
# costs nothing; the same failure after the services are stopped costs a
# service outage.

Info "checking the bundle"

if (-not (Test-Path $BundlePath)) { Fail "no bundle at $BundlePath" }
foreach ($required in @("server.js", "version.json", "prisma\schema.prisma")) {
    if (-not (Test-Path (Join-Path $BundlePath $required))) {
        Fail "bundle is missing $required - was it built with 'npm run package'?"
    }
}

# Built on macOS or Linux without the Windows Prisma target, this bundle starts
# and then dies on its first query. Catch it here, not during service.
$engine = Join-Path $BundlePath "node_modules\.prisma\client\query_engine-windows.dll.node"
if (-not (Test-Path $engine)) {
    Fail @"
bundle has no Windows Prisma engine (query_engine-windows.dll.node).
It was built without binaryTargets including "windows" and will fail on the
first database query. Rebuild and copy it again.
"@
}

# Not fatal: without the native binding sharp falls back to WebAssembly and
# menu photos still resize, only slowly. Worth knowing before service, though.
$sharpWin = Join-Path $BundlePath "node_modules\@img\sharp-win32-x64"
if (-not (Test-Path $sharpWin)) {
    Warn "bundle has no @img/sharp-win32-x64 - photo resizing will use the slow WebAssembly path."
    Warn "Build with 'npm run package:venue' to include the native binding."
}

$newBuild = Get-Content (Join-Path $BundlePath "version.json") -Raw | ConvertFrom-Json
$newLabel = "$($newBuild.version)$(if ($newBuild.commit) { "+$($newBuild.commit)" })"
if ($newBuild.dirty) {
    Warn "this bundle was built from a dirty working tree and cannot be traced to a commit"
}

if (-not (Test-Path $EnvFile)) { Fail "no env file at $EnvFile" }

# The env file is the venue's, not the bundle's - that is why it lives outside
# the release directories and is read rather than replaced.
$envVars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"')
    }
}
foreach ($key in @("DATABASE_URL", "CRON_SECRET")) {
    if (-not $envVars.ContainsKey($key)) { Fail "$EnvFile has no $key" }
}

$currentLabel = "none"
$previousTarget = $null
if (Test-Path $currentLink) {
    $previousTarget = (Get-Item $currentLink).Target | Select-Object -First 1
    $currentVersionFile = Join-Path $currentLink "version.json"
    if (Test-Path $currentVersionFile) {
        $cur = Get-Content $currentVersionFile -Raw | ConvertFrom-Json
        $currentLabel = "$($cur.version)$(if ($cur.commit) { "+$($cur.commit)" })"
    }
}

Info "current: $currentLabel"
Info "new:     $newLabel"

if ($currentLabel -eq $newLabel -and -not $newBuild.dirty) {
    Warn "that version is already live - nothing to do"
    exit 0
}

$stamp = Get-Date -Format "yyyyMMddTHHmm"
$releaseName = "$($newBuild.version)$(if ($newBuild.commit) { "+$($newBuild.commit)" })-$stamp"
$releasePath = Join-Path $releasesDir $releaseName

if (-not $PSCmdlet.ShouldProcess($Root, "deploy $newLabel (current: $currentLabel)")) {
    Info "preflight passed; -WhatIf so stopping here"
    exit 0
}

# ------------------------------------------------------------------- backup --
# Prisma has no down-migrations. Rolling the schema back means restoring this
# dump, so it is taken before anything is stopped and its success is a hard gate.

if (-not $SkipBackup) {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $dump = Join-Path $BackupDir "pre-update-$stamp.dump"
    Info "backing up the database to $dump"

    $dbUri = [uri]$envVars["DATABASE_URL"]
    if (-not $dbUri.UserInfo) { Fail "DATABASE_URL has no user:password - cannot run pg_dump" }
    $dbUser, $dbPass = $dbUri.UserInfo -split ":", 2
    $env:PGPASSWORD = [uri]::UnescapeDataString($dbPass)
    try {
        & pg_dump -Fc -h $dbUri.Host -p $dbUri.Port -U ([uri]::UnescapeDataString($dbUser)) `
            -d $dbUri.AbsolutePath.TrimStart("/") -f $dump
        if ($LASTEXITCODE -ne 0) { Fail "pg_dump failed ($LASTEXITCODE) - not continuing without a backup" }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $dump) -or (Get-Item $dump).Length -eq 0) {
        Fail "backup file is missing or empty - not continuing"
    }
} else {
    Warn "-SkipBackup: no database backup. Rollback will not be able to restore the schema."
}

# ------------------------------------------------------------------- stage ---
# Copied into place while everything is still running, so the window where the
# venue is down covers only the swap, not the transfer.

Info "staging release $releaseName"
New-Item -ItemType Directory -Force -Path $releasesDir | Out-Null
if (Test-Path $releasePath) { Fail "release $releaseName already exists" }
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
Copy-Item -Recurse -Path (Join-Path $BundlePath "*") -Destination $releasePath

# ---------------------------------------------------------------- downtime ---

$rolledBack = $false

function Set-Current {
    param([string]$Target)
    if (Test-Path $currentLink) {
        # A junction must be removed with rmdir, not deleted as a file.
        & cmd /c rmdir "$currentLink" | Out-Null
    }
    & cmd /c mklink /J "$currentLink" "$Target" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not point $currentLink at $Target" }
}

function Stop-All {
    # Reverse order: the agent and shim talk to the app, so they go first.
    for ($i = $Services.Count - 1; $i -ge 0; $i--) {
        $svc = $Services[$i]
        if (Get-Service $svc -ErrorAction SilentlyContinue) {
            Info "stopping $svc"
            Stop-Service $svc -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-All {
    foreach ($svc in $Services) {
        if (Get-Service $svc -ErrorAction SilentlyContinue) {
            Info "starting $svc"
            Start-Service $svc
        } else {
            Warn "service $svc is not installed - start it by hand"
        }
    }
}

function Test-Healthy {
    <# True once the app answers 200 AND reports the version we just deployed.
       A 200 alone is not enough: the old build answers 200 too, so a failed
       swap would look like a success. #>
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $lastError = "no response"
    while ((Get-Date) -lt $deadline) {
        try {
            $res = Invoke-WebRequest -Uri $HealthUrl -Headers @{
                Authorization = "Bearer $($envVars['CRON_SECRET'])"
            } -TimeoutSec 5 -UseBasicParsing
            $body = $res.Content | ConvertFrom-Json
            $live = "$($body.build.version)$(if ($body.build.commit) { "+$($body.build.commit)" })"
            if ($body.status -eq "ok" -and $live -eq $newLabel) { return $true }
            $lastError = "status=$($body.status) version=$live (wanted $newLabel)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 3
    }
    Warn "health check gave up after ${HealthTimeoutSec}s: $lastError"
    return $false
}

try {
    Stop-All
    Info "pointing current -> $releaseName"
    Set-Current -Target $releasePath

    Info "applying migrations"
    Push-Location $currentLink
    try {
        $env:DATABASE_URL = $envVars["DATABASE_URL"]
        # Pinned to match @prisma/client in the bundle; a mismatched CLI can
        # write a migration record the client cannot read. The first run on a
        # machine downloads it, so this step needs internet once.
        & npx --yes "prisma@$PrismaVersion" migrate deploy
        if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed ($LASTEXITCODE)" }
    } finally {
        Pop-Location
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }

    Start-All

    Info "waiting for $newLabel to report healthy"
    if (-not (Test-Healthy)) { throw "new release did not come up healthy" }

    Info "$newLabel is live and healthy"
}
catch {
    Warn "update failed: $($_.Exception.Message)"

    if ($previousTarget -and (Test-Path $previousTarget)) {
        Warn "rolling back to $currentLabel"
        try {
            Stop-All
            Set-Current -Target $previousTarget
            Start-All
            $rolledBack = $true
            Warn "rolled back. NOTE: applied migrations are NOT undone - if the"
            Warn "failure was in migrate, restore the dump in $BackupDir."
        } catch {
            Fail "ROLLBACK FAILED: $($_.Exception.Message) - the venue is down, fix by hand"
        }
    } else {
        Fail "no previous release to roll back to - the venue is down, fix by hand"
    }

    exit 1
}

# ------------------------------------------------------------------ cleanup --
# Only on success, and only ever old releases - the rollback target of the next
# update is among these, so this is the one place a bug is expensive.

if (-not $rolledBack) {
    # Protected regardless of timestamps: pruning either of these would leave the
    # venue with no rollback target, or delete the code it is running.
    $protected = @($releasePath)
    if ($previousTarget) { $protected += $previousTarget }

    $old = Get-ChildItem $releasesDir -Directory |
        Where-Object { $protected -notcontains $_.FullName } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip ([Math]::Max(0, $KeepReleases - $protected.Count))
    foreach ($dir in $old) {
        Info "removing old release $($dir.Name)"
        Remove-Item -Recurse -Force $dir.FullName
    }
}

Info "done: $currentLabel -> $newLabel"
