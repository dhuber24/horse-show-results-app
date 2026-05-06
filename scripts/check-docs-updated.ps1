param()

$ErrorActionPreference = "Stop"

function Test-TruthyEnv {
    param([string]$Value)
    return $Value -in @("1", "true", "TRUE", "yes", "YES", "on", "ON")
}

if (Test-TruthyEnv $env:DOCS_CHECK_BYPASS) {
    Write-Host "Documentation guard bypassed via DOCS_CHECK_BYPASS."
    exit 0
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    Write-Error "Could not determine repository root."
    exit 1
}

Set-Location $repoRoot

$stagedFiles = @(
    git diff --cached --name-only --diff-filter=ACMRT |
        Where-Object { $_ -and $_.Trim() -ne "" } |
        ForEach-Object { $_.Replace("\", "/") }
)

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($stagedFiles.Count -eq 0) {
    exit 0
}

$documentationPatterns = @(
    "^Claude\.md$",
    "^README\.md$",
    "^CONTRIBUTING\.md$",
    "^IMPROVEMENTS\.md$",
    "^docs/",
    "^database/README\.md$",
    "^database/seeds/README\.md$",
    "^frontend/README\.md$",
    "^frontend/CLAUDE\.md$",
    "^frontend/AGENTS\.md$",
    "^\.claude/memory/.*\.md$",
    "^\.github/agents/.*\.md$"
)

$watchedPatterns = @(
    "^backend/",
    "^database/migrations/",
    "^database/schema\.sql$",
    "^database/seed\.sql$",
    "^database/seeds/.*\.sql$",
    "^docker-compose\.yml$",
    "^\.env\.example$",
    "^RUN_TESTS\.sh$",
    "^frontend/app/",
    "^frontend/components/",
    "^frontend/lib/",
    "^frontend/types/",
    "^frontend/auth\.ts$",
    "^frontend/proxy\.ts$",
    "^frontend/package\.json$",
    "^frontend/package-lock\.json$",
    "^frontend/next\.config\.mjs$",
    "^frontend/tsconfig\.json$",
    "^frontend/eslint\.config\.mjs$",
    "^frontend/postcss\.config\.mjs$",
    "^frontend/public/manifest\.json$"
)

function Test-MatchesAnyPattern {
    param(
        [string]$Path,
        [string[]]$Patterns
    )

    foreach ($pattern in $Patterns) {
        if ($Path -match $pattern) {
            return $true
        }
    }
    return $false
}

$documentationChanges = @(
    $stagedFiles | Where-Object { Test-MatchesAnyPattern $_ $documentationPatterns }
)

$watchedChanges = @(
    $stagedFiles | Where-Object { Test-MatchesAnyPattern $_ $watchedPatterns }
)

if ($watchedChanges.Count -eq 0 -or $documentationChanges.Count -gt 0) {
    exit 0
}

Write-Host ""
Write-Host "Documentation guard: staged implementation changes do not include documentation updates." -ForegroundColor Yellow
Write-Host ""
Write-Host "Watched staged files:"
$watchedChanges | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Update one of these docs when behavior, architecture, schema, workflow, or setup changes:"
Write-Host "  - Claude.md"
Write-Host "  - README.md"
Write-Host "  - docs/*.md"
Write-Host "  - database/README.md or database/seeds/README.md"
Write-Host "  - frontend/README.md or frontend/CLAUDE.md"
Write-Host ""
Write-Host "If this change truly has no documentation impact, bypass once with:"
Write-Host "  PowerShell: `$env:DOCS_CHECK_BYPASS='1'; git commit ..."
Write-Host "  Git Bash:   DOCS_CHECK_BYPASS=1 git commit ..."
Write-Host ""

exit 1
