# Applies any unapplied migrations in database/migrations/ to the Neon database.
# Requires DATABASE_URL in .env or environment.
#
# The target is always printed before anything runs. If it is a known production
# host, the run is refused unless -AllowProduction is passed.
#
# Production hosts are matched by SHA-256, not by name. The guard has to travel
# with the repository -- it previously lived only in PRODUCTION_DATABASE_HOST in
# a gitignored .env, so any environment without that file (a Codespace, a fresh
# clone, CI) silently had no guard at all, which is the same failure as a health
# check that only tests SELECT 1. This repository is public, so the hostname
# itself is not committed; a hash guards it without publishing infrastructure.
# PRODUCTION_DATABASE_HOST still works and is *added* to the list rather than
# replacing it, so a misconfigured value can never switch the guard off.
#
# This guard exists because of a real outage. Migration 133 renamed
# show_sanctioning.per_class_fee_cents while the deployed release still mapped
# the old name: every class load returned 500 and /health/ready stayed green,
# because the migration went to the same Neon database production was serving
# from. Applying a migration to production is a release step, and a release step
# should have to be asked for.
param([switch]$AllowProduction)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$migrationsDir = Join-Path $scriptDir "migrations"
$envFile = Join-Path $scriptDir "..\env"

# Load .env if present
$envFile = Resolve-Path (Join-Path $scriptDir "..\.env") -ErrorAction SilentlyContinue
if ($envFile -and (Test-Path $envFile)) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.+)$") {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
}

$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) { Write-Error "DATABASE_URL is not set."; exit 1 }

# Convert asyncpg URL to psql-compatible
$psqlUrl = $dbUrl -replace "postgresql\+asyncpg", "postgresql"

# Say where this is going. Credentials are never printed.
$targetHost = "unknown"
if ($dbUrl -match "@([^/:?]+)") { $targetHost = $matches[1] }
Write-Host "Target database: $targetHost"

# SHA-256 of each known production host, lowercased. Add a line to extend.
$ProductionHostHashes = @(
    "94fdbdfb643086f1296b4ad66abf1ebe8928a2b1963e0975f196e1cf853811ef"  # gaitdesk-api / Render
)

$sha = [System.Security.Cryptography.SHA256]::Create()
$targetHash = (($sha.ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($targetHost.ToLower())
) | ForEach-Object { $_.ToString("x2") }) -join "")

$isProduction = $ProductionHostHashes -contains $targetHash

# An explicitly configured host is additional, never a replacement.
$prodHost = $env:PRODUCTION_DATABASE_HOST
if ($prodHost -and $targetHost -eq $prodHost.Trim()) { $isProduction = $true }

if ($isProduction) {
    if (-not $AllowProduction) {
        Write-Host ""
        Write-Host "Refusing to migrate: $targetHost is a known production database." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "A migration against the database production is serving from breaks"
        Write-Host "the running release the moment it renames or drops anything, and the"
        Write-Host "readiness probe will not go red until the next check."
        Write-Host ""
        Write-Host "To migrate a development branch instead, point DATABASE_URL at it."
        Write-Host "To release to production deliberately, re-run with:"
        Write-Host "  powershell -ExecutionPolicy Bypass -File database/migrate.ps1 -AllowProduction"
        Write-Host ""
        exit 1
    }
    Write-Host "Proceeding against PRODUCTION (-AllowProduction given)." -ForegroundColor Yellow
}

# Ensure migrations tracking table exists
docker run --rm postgres:16-alpine psql $psqlUrl -c "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());" | Out-Null

# Apply each migration in order
Get-ChildItem "$migrationsDir\*.sql" | Sort-Object Name | ForEach-Object {
    $name = $_.Name
    $applied = docker run --rm postgres:16-alpine psql $psqlUrl -tAc "SELECT COUNT(*) FROM _migrations WHERE name = '$name';"
    if ($LASTEXITCODE -ne 0 -or $null -eq $applied) {
        throw "Failed to check migration status for $name."
    }
    if ($applied.Trim() -eq "1") {
        Write-Host "  skipped: $name (already applied)"
    } else {
        Write-Host "  applying: $name"
        docker run --rm -v "${migrationsDir}:/migrations" postgres:16-alpine psql $psqlUrl -v ON_ERROR_STOP=1 -f "/migrations/$name"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to apply migration $name."
        }
        $recorded = docker run --rm postgres:16-alpine psql $psqlUrl -tAc "SELECT COUNT(*) FROM _migrations WHERE name = '$name';"
        if ($LASTEXITCODE -ne 0 -or $null -eq $recorded) {
            throw "Failed to verify migration record for $name."
        }
        if ($recorded.Trim() -ne "1") {
            docker run --rm postgres:16-alpine psql $psqlUrl -c "INSERT INTO _migrations (name) VALUES ('$name');" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to record migration $name."
            }
        }
        Write-Host "  done: $name"
    }
}

Write-Host "Migrations complete."
