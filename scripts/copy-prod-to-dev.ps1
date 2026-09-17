# Copies production data down into the dev branch by running
# scripts/copy_prod_to_dev.sql against dev. See that file for what the copy
# does and how to read its report.
#
# The target is chosen the way database/migrate.ps1 chooses it, and printed
# before anything runs:
#
#   1. -DatabaseUrl <url>
#   2. $env:DATABASE_URL
#   3. DATABASE_URL in .env
#
# The source is -SourceUrl, else $env:PROD_DATABASE_URL, else a prompt. The
# prompt is masked, so the production password stays out of the terminal
# scrollback and out of PSReadLine's history file.
#
# Both ends are guarded. This script refuses a production *target* using the
# same SHA-256 host list as migrate.ps1, before the source password is handed
# to anything, and warns when the source is not production. The SQL then
# refuses again from inside the session, matching on Neon's own endpoint id
# rather than on a hostname -- the direction that would hurt is copying dev's
# test data up into production.
param(
    # The database to copy INTO. Without this, $env:DATABASE_URL, then .env.
    [string]$DatabaseUrl,
    # The database to copy FROM. Without this, $env:PROD_DATABASE_URL, then a
    # masked prompt.
    [string]$SourceUrl
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$sqlFile = "copy_prod_to_dev.sql"

if (-not (Test-Path (Join-Path $scriptDir $sqlFile))) {
    Write-Host "$sqlFile is not next to this script." -ForegroundColor Yellow
    exit 1
}

# Load .env, but NEVER over a variable the environment already carries -- same
# rule as migrate.ps1, and for the same reason.
$envFile = Resolve-Path (Join-Path $repoRoot ".env") -ErrorAction SilentlyContinue
if ($envFile -and (Test-Path $envFile)) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.+)$") {
            $name = $matches[1].Trim()
            if (-not [System.Environment]::GetEnvironmentVariable($name)) {
                [System.Environment]::SetEnvironmentVariable($name, $matches[2])
            }
        }
    }
}

if ($DatabaseUrl) {
    $targetUrl = $DatabaseUrl
    $targetSource = "-DatabaseUrl"
} else {
    $targetUrl = $env:DATABASE_URL
    $targetSource = "DATABASE_URL (environment or .env)"
}
if (-not $targetUrl) { Write-Host "DATABASE_URL is not set." -ForegroundColor Yellow; exit 1 }
$targetUrl = $targetUrl -replace "postgresql\+asyncpg", "postgresql"

$targetHost = "unknown"
if ($targetUrl -match "@([^/:?]+)") { $targetHost = $matches[1] }

# SHA-256 of each known production host, read from the file migrate.ps1 and
# migrate.sh already share so the three runners cannot disagree about what
# production is.
$hashFile = Join-Path $repoRoot "database\production-hosts.sha256"
$ProductionHostHashes = @()
if (Test-Path $hashFile) {
    $ProductionHostHashes = Get-Content $hashFile | ForEach-Object {
        ($_ -split "#")[0].Trim().ToLower()
    } | Where-Object { $_ -match "^[0-9a-f]{64}$" }
}
if ($ProductionHostHashes.Count -eq 0) {
    Write-Host "No production host hashes loaded from $hashFile - refusing to run with the guard disabled." -ForegroundColor Yellow
    exit 1
}

$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-HostHash([string]$value) {
    if (-not $value) { return "" }
    return (($sha.ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($value.ToLower())
    ) | ForEach-Object { $_.ToString("x2") }) -join "")
}
function Test-IsProduction([string]$candidate) {
    # The hash list holds direct hosts. A -pooler host is the same database
    # under another name, so it has to normalise to the same thing or the
    # guard is one URL away from not firing.
    $candidate = $candidate -replace "-pooler\.", "."
    if ($ProductionHostHashes -contains (Get-HostHash $candidate)) { return $true }
    # An explicitly configured host is additional, never a replacement.
    $configured = $env:PRODUCTION_DATABASE_HOST
    if ($configured -and $candidate -eq $configured.Trim()) { return $true }
    return $false
}

Write-Host "Copy into: $targetHost"
Write-Host "  (from $targetSource)"

if (Test-IsProduction $targetHost) {
    Write-Host ""
    Write-Host "Refusing to copy: $targetHost is a known production database." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This script writes to the database it is pointed at. Copying into"
    Write-Host "production would put development data into the live show records."
    Write-Host ""
    Write-Host "Point DATABASE_URL at the dev branch, or pass -DatabaseUrl."
    Write-Host ""
    exit 1
}

if (-not $SourceUrl) { $SourceUrl = $env:PROD_DATABASE_URL }
if (-not $SourceUrl) {
    Write-Host ""
    Write-Host "Production connection string (Neon console > production branch > Connect)."
    Write-Host "It is not echoed and not kept in shell history."
    $secure = Read-Host -AsSecureString "Copy from"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $SourceUrl = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
if (-not $SourceUrl) { Write-Host "No source database given." -ForegroundColor Yellow; exit 1 }
$SourceUrl = $SourceUrl -replace "postgresql\+asyncpg", "postgresql"

$sourceHost = "unknown"
if ($SourceUrl -match "@([^/:?]+)") { $sourceHost = $matches[1] }
Write-Host "Copy from: $sourceHost"

if ($sourceHost -eq $targetHost) {
    Write-Host "Source and target are the same database ($targetHost)." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-IsProduction $sourceHost)) {
    Write-Host "  note: that is not a known production host. Continuing." -ForegroundColor Yellow
}
Write-Host ""

# Passed to the container by name, so the password is never an argument on a
# command line any other process can read.
$env:PROD_DATABASE_URL = $SourceUrl
try {
    docker run --rm -e PROD_DATABASE_URL -v "${scriptDir}:/s" postgres:17-alpine `
        psql $targetUrl -X -v ON_ERROR_STOP=1 -f "/s/$sqlFile"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "The copy failed. Nothing was written: it runs as a single transaction." -ForegroundColor Yellow
        exit 1
    }
} finally {
    Remove-Item Env:\PROD_DATABASE_URL -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Copy complete."
