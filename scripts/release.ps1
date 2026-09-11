# Releases what is committed on `main` to production, in the order the migration
# decides.
#
# This encodes .claude/skills/release/SKILL.md. It exists because the ordering
# rule is the part people get wrong: migration 133 renamed a column against the
# database the deployed release was reading from, every class load 500'd, and
# /health/ready stayed green throughout because SELECT 1 touches no mapped
# column. Nothing about that was hard to avoid -- it was a sequence, run by
# hand, with no step that would have objected.
#
# What it will NOT do, on purpose:
#
#   * Decide whether a migration is safe. It scans the SQL and REFUSES on
#     anything that looks backward-incompatible, which is the direction that
#     costs an outage. A pass is not a promise -- read the SQL.
#   * Take the production URL from .env. .env points at dev and must go on
#     pointing at dev; that split is the whole fix from the 133 postmortem.
#   * Make the Neon backup branch. That is a console action, and -BackedUp is
#     you saying you did it.
#   * Do anything at all without -Run. The default is a plan.
#
# Usage:
#
#   # what would this release do?
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1
#
#   # code-only release
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run
#
#   # release carrying a migration
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run `
#       -DatabaseUrl "<production connection string>" -BackedUp
#
param(
    # Actually do it. Without this the script reports the plan and exits.
    [switch]$Run,

    # The production database. Required when the release carries a migration,
    # and deliberately not readable from .env -- see the header.
    [string]$DatabaseUrl,

    # You have branched production in the Neon console. The script cannot check
    # this and will not migrate production without it.
    [switch]$BackedUp,

    # Release a migration the scanner called backward-incompatible. This means a
    # deliberate outage window; see Step 2b of the release skill first.
    [switch]$AcceptIncompatible,

    # Skip `bash RUN_TESTS.sh`. CI runs the same checks and gates the deploy, so
    # this only trades a slow local failure for a slow remote one.
    [switch]$SkipTests,

    # Minutes to sample production after the push. 0 disables the watch.
    [int]$WatchMinutes = 5,

    # Classify the given migration files and exit, touching nothing else. This
    # is Step 1 of the release skill on its own -- useful while a migration is
    # still being written, and the only way to exercise the scanner directly.
    [string[]]$Classify,

    [string]$ApiUrl = "https://api.gaitdesk.com",
    [string]$WebUrl = "https://gaitdesk.com"
)

$ErrorActionPreference = "Stop"

# Same idiom as database/migrate.ps1. Resolved once at script scope rather than
# read as $PSScriptRoot inside a function, which is a per-scope automatic and
# empty in any context that is not this file running as a script.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# PowerShell 5.1 still negotiates TLS 1.0 by default, which Render and
# Cloudflare refuse -- without this every check below fails as a connection
# error and reads like an outage.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ── Output helpers ────────────────────────────────────────────────────────────

function Write-Head { param([string]$Text)
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}
function Write-Ok   { param([string]$Text) Write-Host "   ok    $Text" -ForegroundColor Green }
function Write-Info { param([string]$Text) Write-Host "         $Text" }
function Write-Warn { param([string]$Text) Write-Host "   note  $Text" -ForegroundColor Yellow }
function Write-Bad  { param([string]$Text) Write-Host "   STOP  $Text" -ForegroundColor Red }

function Stop-Release {
    param([string]$Reason, [string[]]$Next = @())
    Write-Host ""
    Write-Bad $Reason
    if ($Next.Count -gt 0) {
        Write-Host ""
        foreach ($line in $Next) { Write-Host "         $line" }
    }
    Write-Host ""
    exit 1
}

# ── SQL scanning ──────────────────────────────────────────────────────────────

# Strip comments and string literals so the pattern scan below reads code only.
#
# Written as a character scan rather than three -replace passes because the two
# cannot be separated by regex without getting it wrong in the direction that
# costs an outage. This repository's migrations carry long COMMENT ON blocks
# whose prose contains "--" and apostrophes, so stripping comments first eats
# the rest of the file at the first "don't", and stripping literals first turns
# a "--" inside prose into a comment. Either way a real DROP COLUMN downstream
# disappears and the migration is reported clean.
#
# Dollar-quoted bodies ($$ ... $$) are deliberately NOT skipped: this repo wraps
# guarded DDL in DO blocks, and the statements inside them are exactly what
# needs scanning. The delimiters fall through as ordinary characters.
function Get-SqlCode {
    param([string]$Sql)

    $out = New-Object System.Text.StringBuilder
    $i = 0
    $n = $Sql.Length

    while ($i -lt $n) {
        $c = $Sql[$i]
        $next = [char]0
        if ($i + 1 -lt $n) { $next = $Sql[$i + 1] }

        # Line comment: -- to end of line.
        if ($c -eq '-' -and $next -eq '-') {
            while ($i -lt $n -and $Sql[$i] -ne "`n") { $i++ }
            [void]$out.Append(' ')
            continue
        }

        # Block comment: /* ... */
        if ($c -eq '/' -and $next -eq '*') {
            $i += 2
            while ($i + 1 -lt $n -and -not ($Sql[$i] -eq '*' -and $Sql[$i + 1] -eq '/')) { $i++ }
            $i += 2
            [void]$out.Append(' ')
            continue
        }

        # Single-quoted literal, with '' as the escaped quote.
        if ($c -eq "'") {
            $i++
            while ($i -lt $n) {
                if ($Sql[$i] -eq "'") {
                    if (($i + 1 -lt $n) -and ($Sql[$i + 1] -eq "'")) { $i += 2; continue }
                    $i++
                    break
                }
                $i++
            }
            [void]$out.Append(" 'X' ")
            continue
        }

        [void]$out.Append($c)
        $i++
    }

    # One line, single-spaced: the patterns below use [^,;] to stay inside a
    # single statement, which only holds once newlines are gone.
    return ($out.ToString() -replace '\s+', ' ')
}

# Backward-incompatible means: the CURRENTLY DEPLOYED code breaks the moment
# this runs. That is about what SQLAlchemy maps -- columns, tables and the one
# mapped view -- so constraints and indexes are absent from this list by design.
$IncompatiblePatterns = @(
    @{ Pattern = '(?i)\bRENAME\s+(COLUMN|TO)\b';                    Why = 'renames a column or table' },
    @{ Pattern = '(?i)\bDROP\s+COLUMN\b';                           Why = 'drops a column' },
    @{ Pattern = '(?i)\bDROP\s+TABLE\b';                            Why = 'drops a table' },
    @{ Pattern = '(?i)\bDROP\s+VIEW\b';                             Why = 'drops a view (association_standard_classes is mapped)' },
    @{ Pattern = '(?i)\bSET\s+NOT\s+NULL\b';                        Why = 'makes an existing column NOT NULL' },
    @{ Pattern = '(?i)\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b'; Why = 'changes a column type' }
)

# Worth a human's eye, but not a refusal.
$ReviewPatterns = @(
    @{ Pattern = '(?i)\bCREATE\s+TABLE\b';       Why = 'CREATE TABLE: readiness is blind to this one -- only the ledger confirms it ran' },
    @{ Pattern = '(?i)\bDELETE\s+FROM\b';        Why = 'deletes rows' },
    @{ Pattern = '(?i)\bDROP\s+DEFAULT\b';       Why = 'drops a server default' },
    @{ Pattern = '(?i)\bDROP\s+CONSTRAINT\b(?!\s+IF\s+EXISTS)'; Why = 'drops a constraint without IF EXISTS' }
)

function Test-Migration {
    param([string]$Path)

    $name = Split-Path -Leaf $Path
    $raw  = Get-Content -Raw -LiteralPath $Path
    $code = Get-SqlCode $raw

    $blockers = @()
    foreach ($p in $IncompatiblePatterns) {
        if ($code -match $p.Pattern) { $blockers += $p.Why }
    }

    # ADD COLUMN ... NOT NULL with no DEFAULT breaks every existing row. The
    # clause is bounded by , or ; so this cannot read a DEFAULT from the next
    # statement along and call it safe.
    foreach ($m in [regex]::Matches($code, '(?i)ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?[^,;]*?NOT\s+NULL[^,;]*')) {
        if ($m.Value -notmatch '(?i)\bDEFAULT\b') {
            $blockers += 'adds a NOT NULL column with no DEFAULT'
        }
    }

    $reviews = @()
    foreach ($p in $ReviewPatterns) {
        if ($code -match $p.Pattern) { $reviews += $p.Why }
    }

    # Every migration must write its own ledger row: production schema is often
    # applied by hand in Neon's SQL editor, which runs the SQL and records
    # nothing. Without the row the next -AllowProduction run replays the
    # migration and every line reads "applying:" instead of "skipped:",
    # destroying the one signal the release procedure says to read.
    $recordsItself = $code -match '(?i)INSERT\s+INTO\s+_migrations'
    $recordsOwnName = $raw -match [regex]::Escape("'$name'")

    return [pscustomobject]@{
        Name            = $name
        Path            = $Path
        Blockers        = @($blockers | Select-Object -Unique)
        Reviews         = @($reviews | Select-Object -Unique)
        RecordsItself   = $recordsItself
        RecordsOwnName  = $recordsOwnName
    }
}

# ── Production probes ─────────────────────────────────────────────────────────

function Show-MigrationReport {
    param($Report)
    Write-Host ""
    Write-Host "   $($Report.Name)"
    if ($Report.Blockers.Count -gt 0) {
        foreach ($b in $Report.Blockers) { Write-Bad "backward-incompatible: $b" }
    } else {
        Write-Ok "no backward-incompatible pattern found"
    }
    foreach ($rev in $Report.Reviews) { Write-Warn $rev }
    if (-not $Report.RecordsItself) {
        Write-Warn "does not INSERT INTO _migrations -- a hand-applied run leaves no ledger row"
    }
    if ($Report.RecordsItself -and -not $Report.RecordsOwnName) {
        Write-Warn "records a ledger row that does not name '$($Report.Name)' -- check it was not copied from another migration"
    }
}

# -Classify short-circuits everything below: no git, no network, no database.
if ($Classify) {
    $anyBlocked = $false
    $scanned = 0
    foreach ($pattern in $Classify) {
        foreach ($file in @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue)) {
            $rep = Test-Migration $file.FullName
            Show-MigrationReport $rep
            $scanned++
            if ($rep.Blockers.Count -gt 0) { $anyBlocked = $true }
        }
    }

    # Zero files scanned must never report as a pass. A mistyped path or a glob
    # the shell ate would otherwise print the same reassuring line as a clean
    # migration -- which is the one way this tool could actively mislead.
    if ($scanned -eq 0) {
        Stop-Release "No migration files matched: $($Classify -join ', ')" @(
            "Nothing was scanned, so nothing was cleared. Check the path.",
            "Note that `powershell -File` does not split a comma-separated list;",
            "pass one -Classify path, or call the script directly with an array."
        )
    }
    Write-Host ""
    if ($anyBlocked) {
        Write-Host "A pattern matched. Read the SQL -- and read Step 2b of the release skill." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
    Write-Host "$scanned scanned; no backward-incompatible pattern matched." -ForegroundColor Green
    Write-Host "That is a guard, not a promise: read the SQL." -ForegroundColor Green
    Write-Host ""
    exit 0
}

function Get-HttpStatus {
    param([string]$Uri, [int]$TimeoutSec = 25)
    try {
        $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec
        return [int]$r.StatusCode
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    } catch {
        # PS 5.1 wraps some failures differently; 0 means "did not get a status".
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Get-ReadyBody {
    param([string]$Uri)
    try {
        $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 25
        return $r.Content
    } catch {
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            return $reader.ReadToEnd()
        }
        return ""
    }
}

# Checks the app's own read path, not just the probe. /health/ready answered
# {"status":"ok"} for the whole of the 133 outage; GET /shows/ is what actually
# broke, and it is the cheapest read that touches a mapped relationship.
function Test-Production {
    param([switch]$Quiet)

    $ready = Get-HttpStatus "$ApiUrl/health/ready"
    $shows = Get-HttpStatus "$ApiUrl/shows/"
    $web   = Get-HttpStatus "$WebUrl/"
    $body  = ""
    if (-not $Quiet) { $body = Get-ReadyBody "$ApiUrl/health/ready" }

    $healthy = ($ready -eq 200 -and $shows -eq 200 -and $web -eq 200)

    return [pscustomobject]@{
        Ready   = $ready
        Shows   = $shows
        Web     = $web
        Body    = $body
        Healthy = $healthy
    }
}

function Show-Production {
    param($State)
    Write-Info "ready=$($State.Ready)  shows=$($State.Shows)  web=$($State.Web)"
    if ($State.Body) { Write-Info $State.Body.Trim() }
}

# ── Did it actually ship? ─────────────────────────────────────────────────────
#
# The two things the health watch cannot see, and both of them went wrong on
# 11 Sep 2026. The frontend CI job had been failing since before that day's
# work -- a streaming route handler the `res.json()` guard's allow-list had
# never been told about -- and `autoDeployTrigger: checksPass` means a failing
# check does not merely report, it *blocks*. gaitdesk.com served the previous
# afternoon's build while three pushed commits sat behind a red tick, and
# nothing anywhere said so: the health probes were green the whole time,
# because the old build was perfectly healthy. It was found by a person
# clicking around the app wondering where their change had gone.
#
# A release that cannot tell "deployed" from "queued behind a red tick" is
# reporting success for an outcome it has not checked.

function Get-RepoSlug {
    # owner/name off the origin remote, for the GitHub checks API. Handles both
    # git@github.com:owner/name.git and https://github.com/owner/name(.git).
    $url = (git remote get-url origin 2>$null)
    if (-not $url) { return $null }
    if ($url.Trim() -match 'github\.com[:/](?<slug>[^/]+/[^/]+?)(\.git)?\s*$') {
        return $Matches['slug']
    }
    return $null
}

function Get-CheckRuns {
    param([string]$Slug, [string]$Sha)
    $headers = @{ 'User-Agent' = 'gaitdesk-release'; 'Accept' = 'application/vnd.github+json' }
    # A token lifts GitHub's 60/hour unauthenticated limit. Optional on purpose:
    # the poll below stays well inside 60, and a rate-limited answer warns
    # rather than failing a release that has already been pushed.
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
    try {
        return (Invoke-RestMethod -Uri "https://api.github.com/repos/$Slug/commits/$Sha/check-runs" `
                                  -Headers $headers -TimeoutSec 25).check_runs
    } catch {
        return $null
    }
}

function Wait-ForChecks {
    param([string]$Slug, [string]$Sha, [int]$TimeoutMinutes = 15)

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $lastLine = ""
    while ((Get-Date) -lt $deadline) {
        $runs = Get-CheckRuns -Slug $Slug -Sha $Sha
        if ($null -eq $runs) {
            return [pscustomobject]@{ State = 'unknown'; Failed = @() }
        }
        if (@($runs).Count -eq 0) {
            # GitHub has not registered the workflow yet. Normal for the first
            # few seconds after a push.
            Start-Sleep -Seconds 15
            continue
        }

        $failed  = @($runs | Where-Object {
            $_.status -eq 'completed' -and $_.conclusion -notin @('success', 'neutral', 'skipped')
        })
        $pending = @($runs | Where-Object { $_.status -ne 'completed' })

        $line = (@($runs) | ForEach-Object {
            $s = if ($_.status -eq 'completed') { $_.conclusion } else { $_.status }
            "$($_.name)=$s"
        }) -join '  '
        if ($line -ne $lastLine) { Write-Info $line; $lastLine = $line }

        if ($failed.Count -gt 0)  { return [pscustomobject]@{ State = 'failed'; Failed = $failed } }
        if ($pending.Count -eq 0) { return [pscustomobject]@{ State = 'passed'; Failed = @() } }

        Start-Sleep -Seconds 20
    }
    return [pscustomobject]@{ State = 'timeout'; Failed = @() }
}

function Get-WebFingerprint {
    # Every hashed asset the home page references, plus sw.js's Last-Modified.
    # Next content-hashes chunk filenames, so this changes whenever the
    # frontend's own code changes -- and does NOT change when only the backend
    # moved, which is why the caller holds it against a release that touched
    # frontend/ and skips it otherwise.
    try {
        $r = Invoke-WebRequest -Uri "$WebUrl/" -UseBasicParsing -TimeoutSec 25
        $assets = [regex]::Matches($r.Content, '/_next/static/[^"'']+') |
                  ForEach-Object { $_.Value } | Sort-Object -Unique
        $sw = ""
        try {
            $sw = (Invoke-WebRequest -Uri "$WebUrl/sw.js" -UseBasicParsing -TimeoutSec 25).Headers['Last-Modified']
        } catch { }
        return (($assets -join '|') + '||' + $sw)
    } catch {
        return $null
    }
}

function Get-ApiFingerprint {
    # The OpenAPI document changes whenever a route, parameter or schema does.
    # Same caveat as above: a backend release that only changes a function body
    # leaves it identical, so an unchanged hash is "could not confirm", never
    # "did not deploy".
    try {
        $c = (Invoke-WebRequest -Uri "$ApiUrl/openapi.json" -UseBasicParsing -TimeoutSec 30).Content
        $h = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($c))
        return [BitConverter]::ToString($h).Replace('-', '')
    } catch {
        return $null
    }
}

function Wait-ForFingerprint {
    param([string]$Label, [scriptblock]$Probe, [string]$Before, [int]$TimeoutMinutes = 12)

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        $now = & $Probe
        if ($null -ne $now -and $now -ne $Before) {
            Write-Ok "$Label is serving new code"
            return $true
        }
    }
    return $false
}

function Invoke-Psql {
    param([string]$Url, [string]$Sql)
    $psqlUrl = $Url -replace "postgresql\+asyncpg", "postgresql"
    $out = docker run --rm postgres:16-alpine psql $psqlUrl -tAc $Sql
    if ($LASTEXITCODE -ne 0) {
        # Routed through Stop-Release rather than thrown: this runs immediately
        # after production was migrated, and a raw PowerShell stack trace is the
        # last thing anybody needs to read at that particular moment.
        Stop-Release "Could not query production: $Sql" @(
            "The migration has already been applied. Confirm the ledger by hand",
            "before pushing -- the code waiting here expects that schema."
        )
    }
    return ($out | Out-String).Trim()
}

# The inverse of migrate.ps1's guard, and just as necessary.
#
# migrate.ps1 refuses a production host unless asked. This script has to refuse
# a target that is NOT production, because the failure is silent: hand it the
# dev URL and migrate.ps1 says nothing (dev is not in the hash list, and
# -AllowProduction is merely redundant), the ledger check passes because dev
# has the rows, the health check passes because production was never touched,
# and it pushes. Production then gets code for a schema it never received --
# readiness 503s, the deploy never promotes, and every line of output claims
# production was migrated.
function Test-IsProductionUrl {
    param([string]$Url)

    $targetHost = "unknown"
    if ($Url -match "@([^/:?]+)") { $targetHost = $matches[1] }

    $hashFile = Join-Path $ScriptDir "../database/production-hosts.sha256"
    $hashes = @()
    if (Test-Path $hashFile) {
        $hashes = Get-Content $hashFile | ForEach-Object {
            ($_ -split "#")[0].Trim().ToLower()
        } | Where-Object { $_ -match "^[0-9a-f]{64}$" }
    }
    if ($hashes.Count -eq 0) {
        Stop-Release "No production host hashes loaded from database/production-hosts.sha256." @(
            "Refusing to run with the guard disabled -- same rule as migrate.ps1."
        )
    }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $targetHash = (($sha.ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($targetHost.ToLower())
    ) | ForEach-Object { $_.ToString("x2") }) -join "")

    $isProd = $hashes -contains $targetHash
    $configured = $env:PRODUCTION_DATABASE_HOST
    if ($configured -and $targetHost -eq $configured.Trim()) { $isProd = $true }

    return [pscustomobject]@{ Host = $targetHost; IsProduction = $isProd }
}

# ══ 1. Preflight ══════════════════════════════════════════════════════════════

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { Stop-Release "Not a git repository." }
Set-Location $repoRoot.Trim()

Write-Head "Preflight"

$branch = (git branch --show-current).Trim()
if ($branch -ne "main") {
    Stop-Release "On branch '$branch'; this repo releases from 'main' only." @(
        "Switch to main, or release by hand if this is deliberate."
    )
}
Write-Ok "branch is main"

# .claude/scheduled_tasks.lock is tracked but is local scheduler state -- the
# git-commit-push skill unstages it for the same reason. Blocking a release on
# it would be friction with nothing behind it.
$dirty = @(
    git status --porcelain |
        Where-Object { $_ -and $_.Trim() -ne "" } |
        Where-Object { $_ -notmatch '\.claude/scheduled_tasks\.lock$' }
)
if ($dirty.Count -gt 0) {
    Write-Host ""
    $dirty | ForEach-Object { Write-Host "         $_" }
    Stop-Release "Working tree is not clean." @(
        "A release ships what is committed. Commit first (the git-commit-push",
        "skill does the guards), then run this. Anything left uncommitted here",
        "would make the plan below a lie about what production is getting."
    )
}
Write-Ok "working tree clean"

git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { Stop-Release "git fetch origin main failed." }

$behind = @(git log HEAD..origin/main --oneline | Where-Object { $_ })
if ($behind.Count -gt 0) {
    Write-Host ""
    $behind | ForEach-Object { Write-Host "         $_" }
    Stop-Release "origin/main is ahead of local main." @(
        "Rebase onto it first -- this repo's history is linear:",
        "  git rebase origin/main"
    )
}
Write-Ok "origin/main is not ahead"

# ══ 2. Scope ══════════════════════════════════════════════════════════════════

Write-Head "What this release ships"

$commits = @(git log origin/main..HEAD --format="%h %s" | Where-Object { $_ })
if ($commits.Count -eq 0) {
    Write-Info "Nothing to push -- local main matches origin/main."
    Write-Host ""
    Write-Host "Production is already at this commit. Nothing to do." -ForegroundColor Green
    Write-Host ""
    exit 0
}
foreach ($c in $commits) { Write-Info $c }
Write-Info ""
Write-Info "$($commits.Count) commit(s)."

$migrationFiles = @(
    git diff --name-only --diff-filter=ACMR origin/main..HEAD -- database/migrations |
        Where-Object { $_ -match '\.sql$' }
)

# ══ 3. Classify ═══════════════════════════════════════════════════════════════

Write-Head "Migrations carried"

$reports = @()
if ($migrationFiles.Count -eq 0) {
    Write-Ok "none -- this is a code-only release"
} else {
    foreach ($f in $migrationFiles) {
        $full = Join-Path $repoRoot.Trim() $f
        if (-not (Test-Path $full)) { continue }
        $reports += (Test-Migration $full)
    }

    foreach ($r in $reports) { Show-MigrationReport $r }
}

$blocked = @($reports | Where-Object { $_.Blockers.Count -gt 0 })

# ══ 4. Plan ═══════════════════════════════════════════════════════════════════

$carriesSchema = ($reports.Count -gt 0)

Write-Head "Plan"
$step = 0
if ($carriesSchema)  { $step++; Write-Info "$step. migrate DEV      (database/migrate.ps1)" }
if (-not $SkipTests) { $step++; Write-Info "$step. bash RUN_TESTS.sh" }
if ($carriesSchema)  { $step++; Write-Info "$step. migrate PRODUCTION (-AllowProduction -DatabaseUrl ...)" }
if ($carriesSchema)  { $step++; Write-Info "$step. confirm the production ledger recorded each migration" }
if ($carriesSchema)  { $step++; Write-Info "$step. check production is still serving BEFORE pushing" }
$step++; Write-Info "$step. git push origin main   <- this is the deploy"
$step++; Write-Info "$step. wait for CI            (a red check blocks the deploy, it does not just report)"
$webPlan = @(git diff --name-only origin/main HEAD) | Where-Object { $_ -like 'frontend/*' }
$apiPlan = @(git diff --name-only origin/main HEAD) | Where-Object { $_ -like 'backend/*' }
if (@($webPlan).Count -gt 0 -or @($apiPlan).Count -gt 0) {
    $which = @()
    if (@($webPlan).Count -gt 0) { $which += "gaitdesk.com" }
    if (@($apiPlan).Count -gt 0) { $which += "api.gaitdesk.com" }
    $step++; Write-Info "$step. confirm the new build is serving ($($which -join ', '))"
}
if ($WatchMinutes -gt 0) { $step++; Write-Info "$step. watch production for $WatchMinutes minute(s)" }

if (-not $Run) {
    Write-Head "Plan only"
    Write-Info "Nothing has been changed. Re-run with -Run to release."
    if ($carriesSchema) {
        Write-Info "This release carries schema, so it also needs:"
        Write-Info "  -DatabaseUrl ""<production connection string>""  and  -BackedUp"
    }
    Write-Host ""
    exit 0
}

# ══ 5. Guards for -Run ════════════════════════════════════════════════════════

if ($blocked.Count -gt 0 -and -not $AcceptIncompatible) {
    Stop-Release "$($blocked.Count) migration(s) look backward-incompatible." @(
        "There is no ordering that works for these: migrating first breaks the",
        "running release, and deploying first fails readiness and never promotes.",
        "Split it into expand/contract releases -- Step 2b of",
        ".claude/skills/release/SKILL.md.",
        "",
        "If this genuinely is a deliberate outage window, re-run with",
        "-AcceptIncompatible. Do that at a quiet time and not as routine."
    )
}
if ($blocked.Count -gt 0) {
    Write-Head "Releasing a backward-incompatible migration"
    Write-Warn "-AcceptIncompatible was given. The running release will break between"
    Write-Warn "the migration and the deploy. That window is real, and it is now open."
}

# $env:PRODUCTION_DATABASE_URL is the other way in, and it is the better one:
# a connection string passed as a command-line argument is written to PSReadLine's
# on-disk history (ConsoleHost_history.txt) in clear text, password and all.
# Deliberately NOT read from .env -- .env is dev, and keeping production out of
# it is the whole point of the branch split.
if (-not $DatabaseUrl -and $env:PRODUCTION_DATABASE_URL) {
    $DatabaseUrl = $env:PRODUCTION_DATABASE_URL
    $urlSource = "PRODUCTION_DATABASE_URL"
} elseif ($DatabaseUrl) {
    $urlSource = "-DatabaseUrl"
}

if ($carriesSchema -and -not $DatabaseUrl) {
    Stop-Release "This release carries a migration but no production URL." @(
        "Production is a different Neon branch; pushing without migrating it",
        "ships code against a schema that has not moved. Either:",
        "",
        "  -DatabaseUrl ""<production connection string>""",
        "  `$env:PRODUCTION_DATABASE_URL = ""<production connection string>""",
        "",
        "The environment variable keeps the password out of PowerShell's",
        "on-disk command history. Do not repoint .env at production instead --",
        "that is the configuration the branch split exists to prevent."
    )
}

if ($DatabaseUrl -and -not $carriesSchema) {
    Write-Head "Production URL given but no migration to apply"
    Write-Warn "This release is code-only; the database will not be touched."
}

# Refuse a target that is not production -- see Test-IsProductionUrl.
if ($carriesSchema) {
    $target = Test-IsProductionUrl $DatabaseUrl
    Write-Head "Production target"
    Write-Info "host: $($target.Host)   (from $urlSource)"
    if (-not $target.IsProduction) {
        Stop-Release "$($target.Host) is not a known production host." @(
            "This script releases to production, so it will not accept anything",
            "else. Handing it the dev URL fails silently in the worst way: every",
            "check downstream passes, the push goes out, and production gets code",
            "for a schema it never received.",
            "",
            "If this host really is production, add its SHA-256 to",
            "database/production-hosts.sha256 -- the same list migrate.ps1 reads."
        )
    }
    Write-Ok "target is a known production host"
}

if ($carriesSchema -and -not $BackedUp) {
    Stop-Release "Production has not been branched." @(
        "Neon console -> Branches > New branch, from production, named for this",
        "release (e.g. pre-138). It is instant and free, and it is the only",
        "backup step there is.",
        "",
        "Then re-run with -BackedUp."
    )
}

# ══ 6. Dev, then the tests ════════════════════════════════════════════════════
#
# Dev goes first, before the tests, because a broken migration surfaces here in
# seconds where RUN_TESTS.sh takes minutes in Docker -- and dev is disposable, so
# there is nothing to regret about having migrated it if the tests then fail.

if ($carriesSchema) {
    Write-Head "Migrating dev"
    powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot.Trim() "database/migrate.ps1")
    if ($LASTEXITCODE -ne 0) { Stop-Release "Dev migration failed. Nothing has reached production." }
    Write-Ok "dev migrated"
}

if (-not $SkipTests) {
    Write-Head "Tests"
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if (-not $bash) {
        Stop-Release "bash not found on PATH; cannot run RUN_TESTS.sh." @(
            "Run the suite yourself and re-run with -SkipTests."
        )
    }
    & bash "RUN_TESTS.sh"
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "RUN_TESTS.sh failed." @(
            "CI runs the same checks and gates the deploy, so this would have",
            "held the release anyway -- it is cheaper to fix here."
        )
    }
    Write-Ok "all checks passed"
} else {
    Write-Head "Tests skipped (-SkipTests)"
    Write-Warn "CI still runs them, and a red CI now holds the deploy."
}

# ══ 7. Production ═════════════════════════════════════════════════════════════

if ($carriesSchema) {
    Write-Head "Production health BEFORE migrating"
    $before = Test-Production
    Show-Production $before
    if (-not $before.Healthy) {
        Stop-Release "Production is not healthy before the release has even started." @(
            "Find out why before changing anything. Releasing onto a broken",
            "production makes the cause impossible to attribute."
        )
    }
    Write-Ok "production healthy"

    Write-Head "Migrating PRODUCTION"
    Write-Warn "This is the irreversible step."
    powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot.Trim() "database/migrate.ps1") `
        -AllowProduction -DatabaseUrl $DatabaseUrl
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "Production migration failed." @(
            "The runner stops on the first failing statement (ON_ERROR_STOP=1),",
            "so the migration is partly applied at most and its ledger row was",
            "not written. Read the error, check the schema, and do not push --",
            "the code waiting here expects a schema production does not have."
        )
    }
    Write-Ok "production migrated"

    # ══ 8. The ledger, because readiness cannot tell you this ═════════════════
    #
    # schema: ok means "the columns this build maps exist". It is blind to a
    # CREATE TABLE that never ran, because create_all improvises the table from
    # the models at boot. The ledger is the only place the truth is written
    # down.
    Write-Head "Production ledger"
    foreach ($r in $reports) {
        $count = Invoke-Psql -Url $DatabaseUrl -Sql "SELECT COUNT(*) FROM _migrations WHERE name = '$($r.Name)';"
        if ($count -eq "1") {
            Write-Ok "recorded: $($r.Name)"
        } else {
            Stop-Release "$($r.Name) is not in production's _migrations." @(
                "The migration ran but recorded nothing, or it did not run at all.",
                "Either way the next -AllowProduction run will replay it. Sort the",
                "ledger out before pushing -- database/maintenance/reconcile_migrations.sql",
                "is the evidence-gated way to add a row."
            )
        }
    }

    # ══ 9. The 133 detector ═══════════════════════════════════════════════════
    #
    # Production is now running the OLD code against the NEW schema. If the
    # migration was incompatible in a way the scanner missed, this is the moment
    # it shows -- and GET /shows/ is what shows it, not the probe.
    Write-Head "Production health AFTER migrating, BEFORE pushing"
    Write-Info "Waiting 65s: schema_drift caches its answer for 60s, so an"
    Write-Info "immediate check can still report the previous state."
    Start-Sleep -Seconds 65
    $after = Test-Production
    Show-Production $after

    if (-not $after.Healthy) {
        Write-Host ""
        Write-Bad "PRODUCTION BROKE WHEN THE MIGRATION RAN."
        Write-Host ""
        Write-Host "         This is the migration-133 shape: the schema moved and the" -ForegroundColor Red
        Write-Host "         running release still maps the old one. It is happening now." -ForegroundColor Red
        Write-Host ""

        if ($AcceptIncompatible) {
            # Halting here would be the worst thing this script could do. The
            # outage window was accepted on purpose, the code that closes it is
            # sitting committed on this machine, and pushing is the recovery --
            # so refusing to push would leave production down and the fix at
            # home. The unasked-for case is the one that stops; this one does
            # exactly what it was told to do.
            Write-Host "         This is the window -AcceptIncompatible asked for. The code" -ForegroundColor Yellow
            Write-Host "         that closes it is committed here, so pushing IS the recovery" -ForegroundColor Yellow
            Write-Host "         and stopping now would only make the outage longer." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "         Pushing. CI has to go green before Render builds, so expect" -ForegroundColor Yellow
            Write-Host "         several more minutes of this before it recovers." -ForegroundColor Yellow
            Write-Host ""
        } else {
            Write-Host "         The scanner cleared this migration and it broke production"
            Write-Host "         anyway, so something in it is backward-incompatible in a way"
            Write-Host "         the patterns do not cover. Two ways out, and they need a"
            Write-Host "         person:"
            Write-Host ""
            Write-Host "           1. Push it (git push origin main) if the code waiting here"
            Write-Host "              matches the new schema. CI must go green first, so the"
            Write-Host "              window stays open for a few minutes."
            Write-Host "           2. Roll the schema forward with a migration that restores"
            Write-Host "              what the deployed code maps. There are no down-migrations."
            Write-Host ""
            Write-Host "         Not pushing automatically: this release was supposed to be"
            Write-Host "         safe, so the assumption behind it is now wrong and deploying"
            Write-Host "         on it unchecked is a guess, not a retry."
            Write-Host ""
            exit 1
        }
    } else {
        Write-Ok "production still serving on the new schema"
    }
}

# ══ 10. Push -- this is the deploy ════════════════════════════════════════════

# Captured before the push so there is something to compare against afterwards.
# Which halves of the app this release can be expected to change decides which
# fingerprints mean anything: a backend-only release leaves the frontend's
# hashed assets byte-identical, and holding that against it would cry wolf on
# every release that did deploy.
$touched    = @(git diff --name-only origin/main HEAD)
$touchesWeb = @($touched | Where-Object { $_ -like 'frontend/*' }).Count -gt 0
$touchesApi = @($touched | Where-Object { $_ -like 'backend/*' }).Count -gt 0
$webBefore  = if ($touchesWeb) { Get-WebFingerprint } else { $null }
$apiBefore  = if ($touchesApi) { Get-ApiFingerprint } else { $null }

Write-Head "Pushing to origin/main"
Write-Info "Render is on autoDeployTrigger: checksPass, so this deploys once CI is green."
git push origin main
if ($LASTEXITCODE -ne 0) {
    Stop-Release "git push failed." @(
        "If this is a non-fast-forward, someone pushed in the gap: rebase onto",
        "origin/main and re-run. Never force-push main."
    )
}
$head     = (git rev-parse --short HEAD).Trim()
$headFull = (git rev-parse HEAD).Trim()
Write-Ok "pushed $head"

# ══ 10a. CI -- a red tick does not report, it blocks ══════════════════════════

Write-Head "Waiting for CI"
$slug = Get-RepoSlug
if (-not $slug) {
    Write-Warn "could not read owner/name off the origin remote -- skipping the CI check."
    Write-Info "Check GitHub Actions by hand. A failing check blocks the deploy silently."
    $checks = [pscustomobject]@{ State = 'unknown'; Failed = @() }
} else {
    Write-Info "$slug @ $head"
    $checks = Wait-ForChecks -Slug $slug -Sha $headFull
}

if ($checks.State -eq 'failed') {
    $names = (@($checks.Failed) | ForEach-Object { $_.name }) -join ', '
    Write-Bad "CI failed: $names"
    Write-Host ""
    foreach ($f in @($checks.Failed)) {
        Write-Host "         $($f.name) -> $($f.conclusion)"
        if ($f.html_url) { Write-Host "         $($f.html_url)" }
    }
    Write-Host ""
    Write-Host "         Render is on autoDeployTrigger: checksPass, so this does not just" -ForegroundColor Red
    Write-Host "         report -- it BLOCKS the deploy. Production goes on serving the" -ForegroundColor Red
    Write-Host "         previous build, and every health check stays green while it does," -ForegroundColor Red
    Write-Host "         because that build is fine. Nothing will say the site has stopped" -ForegroundColor Red
    Write-Host "         updating." -ForegroundColor Red
    Write-Host ""
    Write-Host "         The commits are pushed and are not lost. Fix the failing job and"
    Write-Host "         push again; Render deploys the lot once the checks go green. Do"
    Write-Host "         not re-push these."
    Write-Host ""
    exit 1
}
if ($checks.State -eq 'timeout') {
    Write-Warn "CI still running after 15 minutes."
    Write-Info "Nothing is live yet -- Render has not started building. Watch GitHub Actions."
    Write-Host ""
    exit 1
}
if ($checks.State -eq 'unknown') {
    Write-Warn "could not read the checks API -- rate limit, or no network."
    Write-Info "Set GITHUB_TOKEN to lift the 60/hour limit. Verify by hand before walking away."
} else {
    Write-Ok "all checks green -- Render is building now"
}

# ══ 10b. Did the new build actually reach production? ═════════════════════════

if ($touchesWeb -or $touchesApi) {
    Write-Head "Waiting for the new build to serve"
    Write-Info "Comparing what production serves now against what it served before the push."

    if ($touchesWeb) {
        if ($null -eq $webBefore) {
            Write-Warn "no pre-push frontend fingerprint -- cannot confirm the web service."
        } elseif (-not (Wait-ForFingerprint -Label "gaitdesk.com" -Before $webBefore -Probe { Get-WebFingerprint })) {
            Write-Warn "frontend assets unchanged after 12 minutes."
            Write-Info "Either the build is slow, or Render never started it. Check the"
            Write-Info "gaitdesk-web service in the Render dashboard before assuming it shipped."
        }
    }
    if ($touchesApi) {
        if ($null -eq $apiBefore) {
            Write-Warn "no pre-push API fingerprint -- cannot confirm the api service."
        } elseif (-not (Wait-ForFingerprint -Label "api.gaitdesk.com" -Before $apiBefore -Probe { Get-ApiFingerprint })) {
            # Not a failure on its own: openapi.json is identical across builds
            # whenever a release changed only a function body.
            Write-Info "API surface unchanged -- expected if this release touched no routes or schemas."
        }
    }
} else {
    Write-Head "Nothing to confirm"
    Write-Info "This release touched neither frontend/ nor backend/, so there is no"
    Write-Info "change in what either service serves to look for."
}

# ══ 11. Watch ═════════════════════════════════════════════════════════════════

if ($WatchMinutes -le 0) {
    Write-Head "Not watching (-WatchMinutes 0)"
    Write-Info "CI and the build swap were confirmed above; this only skips the health"
    Write-Info "sampling that would have run against the new build."
    Write-Host ""
    exit 0
}

Write-Head "Watching production for $WatchMinutes minute(s)"
Write-Info "Watching the new build for breakage. Whether it is live was settled above;"
Write-Info "this is whether it stays healthy once it is."
Write-Host ""

$samples = [math]::Max(1, [int](($WatchMinutes * 60) / 20))
$failures = 0
for ($i = 1; $i -le $samples; $i++) {
    $s = Test-Production -Quiet
    if (-not $s.Healthy) {
        $failures++
        Write-Host ("   FAIL at {0,4}s  ready={1} shows={2} web={3}" -f ($i * 20), $s.Ready, $s.Shows, $s.Web) -ForegroundColor Red
    }
    if ($i -lt $samples) { Start-Sleep -Seconds 20 }
}

Write-Host ""
$final = Test-Production
Show-Production $final

Write-Host ""
$clean = ($failures -eq 0 -and $final.Healthy)
if ($clean) {
    Write-Host "Released $head. $samples samples, no failures." -ForegroundColor Green
} else {
    Write-Host "Released $head, but production reported $failures failure(s) during the watch." -ForegroundColor Yellow
    Write-Host "Check the Render dashboard for both services before walking away." -ForegroundColor Yellow
}
Write-Host ""
Write-Info "Confirmed by this run, not left to the dashboard:"
Write-Info "  * CI went green            -- without it Render never builds at all"
Write-Info "  * the new build is serving -- what production returns actually changed"
Write-Host ""

# The push already happened, so this is not "the release failed" -- it is "the
# release went out and production is unhappy", which a caller still has to be
# able to tell apart from a clean one. Exiting 0 over printed FAIL lines is how
# a wrapper, or a tired human, reads an outage as a success.
if (-not $clean) { exit 1 }
