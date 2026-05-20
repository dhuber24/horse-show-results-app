# Applies any unapplied migrations in database/migrations/ to the Neon database.
# Requires DATABASE_URL in .env or environment.

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
