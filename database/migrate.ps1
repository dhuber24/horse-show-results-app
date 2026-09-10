# Applies any unapplied migrations in database/migrations/ to the Neon database.
#
# The target is chosen in this order, and the choice is printed before anything
# runs:
#
#   1. -DatabaseUrl <url>
#   2. $env:DATABASE_URL
#   3. DATABASE_URL in .env
#
# .env never overwrites a variable the environment already has. It used to, and
# that made the production path unusable: setting $env:DATABASE_URL to
# production and passing -AllowProduction loaded the dev URL from .env straight
# back over it, so the guard saw a dev host, said nothing, and migrated dev
# while the operator believed they had released. Releasing to production is now
# either of:
#
#   database/migrate.ps1 -AllowProduction -DatabaseUrl "<production url>"
#   $env:DATABASE_URL="<production url>"; database/migrate.ps1 -AllowProduction
#
# Production hosts are matched by SHA-256, not by name, from
# database/production-hosts.sha256 -- shared with migrate.sh so the two runners
# cannot disagree. The guard has to travel with the repository: it previously
# lived only in PRODUCTION_DATABASE_HOST in a gitignored .env, so any
# environment without that file (a Codespace, a fresh clone, CI) silently had no
# guard at all, which is the same failure as a health check that only tests
# SELECT 1. This repository is public, so the hostname itself is not committed;
# a hash guards it without publishing infrastructure. PRODUCTION_DATABASE_HOST
# still works and is *added* to the list rather than replacing it, so a
# misconfigured value can never switch the guard off. An unreadable or empty
# hash file is a hard failure rather than an unguarded run.
#
# This guard exists because of a real outage. Migration 133 renamed
# show_sanctioning.per_class_fee_cents while the deployed release still mapped
# the old name: every class load returned 500 and /health/ready stayed green,
# because the migration went to the same Neon database production was serving
# from. Applying a migration to production is a release step, and a release step
# should have to be asked for.
param(
    [switch]$AllowProduction,
    # The database to migrate, highest precedence. Without this the target is
    # $env:DATABASE_URL, and only then .env -- see the precedence note below.
    [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$migrationsDir = Join-Path $scriptDir "migrations"

# Load .env, but NEVER over a variable the environment already carries.
#
# This used to overwrite unconditionally, which made -AllowProduction unusable
# and quietly wrong: setting $env:DATABASE_URL to production and running with
# the flag loaded .env straight back over it, so the target was the *dev*
# branch, the host never matched a production hash, the guard never fired, and
# the run reported success having migrated the wrong database. A value in the
# environment is a deliberate act by the caller; a .env file is a default.
$envFile = Resolve-Path (Join-Path $scriptDir "..\.env") -ErrorAction SilentlyContinue
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
    $dbUrl = $DatabaseUrl
    $dbUrlSource = "-DatabaseUrl"
} else {
    $dbUrl = $env:DATABASE_URL
    $dbUrlSource = "DATABASE_URL (environment or .env)"
}
if (-not $dbUrl) { Write-Error "DATABASE_URL is not set."; exit 1 }

# Convert asyncpg URL to psql-compatible
$psqlUrl = $dbUrl -replace "postgresql\+asyncpg", "postgresql"

# Say where this is going. Credentials are never printed.
$targetHost = "unknown"
if ($dbUrl -match "@([^/:?]+)") { $targetHost = $matches[1] }
Write-Host "Target database: $targetHost"
Write-Host "  (from $dbUrlSource)"

# SHA-256 of each known production host, shared with migrate.sh so adding one
# is a single edit and the two runners cannot disagree about what production is.
$hashFile = Join-Path $scriptDir "production-hosts.sha256"
$ProductionHostHashes = @()
if (Test-Path $hashFile) {
    $ProductionHostHashes = Get-Content $hashFile | ForEach-Object {
        ($_ -split "#")[0].Trim().ToLower()
    } | Where-Object { $_ -match "^[0-9a-f]{64}$" }
}
if ($ProductionHostHashes.Count -eq 0) {
    Write-Error "No production host hashes loaded from $hashFile - refusing to run with the guard disabled."
    exit 1
}

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
        Write-Host "See the release skill (.claude/skills/release/) first: whether the"
        Write-Host "migration goes before or after the deploy is decided by the migration."
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
