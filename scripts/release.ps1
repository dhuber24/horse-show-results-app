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
#     What it WILL read from .env is a 1Password *reference* to the URL
#     (PROD_DATABASE_URL_OP_REF) -- a pointer, not a secret, and not a database
#     anything connects to. .env is never loaded wholesale, so DATABASE_URL
#     stays out of reach, and whatever the reference resolves to still has to
#     pass the production host guard.
#   * Do anything at all without -Run. The default is a plan.
#
# The Neon backup branch it DOES make, when a release carries a migration: cut
# from production just before production is migrated, through Neon's API, named
# for the release (pre-139-d994370) and set to expire after -BackupDays. That
# used to be a console action and -BackedUp was your word that you had done it;
# -BackedUp remains for a machine with no Neon API key.
#
# Configuration, all optional, environment first and then .env:
#
#   PRODUCTION_DATABASE_URL    the connection string itself (environment only)
#   PROD_DATABASE_URL_OP_REF   op://... reference to it
#   NEON_API_KEY               a Neon API key (environment only)
#   NEON_API_KEY_OP_REF        op://... reference to one
#   NEON_PROJECT_ID            the Neon project production lives in
#
# Usage:
#
#   # what would this release do?
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1
#
#   # any release, once the above is configured
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run
#
#   # release carrying a migration, with nothing configured
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run `
#       -DatabaseUrl "<production connection string>" -BackedUp
#
param(
    # Actually do it. Without this the script reports the plan and exits.
    [switch]$Run,

    # The production database. Required when the release carries a migration.
    # Without it: $env:PRODUCTION_DATABASE_URL, then PROD_DATABASE_URL_OP_REF.
    [string]$DatabaseUrl,

    # You branched production in the Neon console yourself. Only needed where
    # no Neon API key is configured; with one, the script makes the branch and
    # this flag skips that step.
    [switch]$BackedUp,

    # How long the backup branch lives before Neon deletes it. Long enough to
    # notice a bad migration; short enough that backups do not pile up against
    # the plan's branch limit.
    [int]$BackupDays = 14,

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

# How many consecutive unreadable responses end the CI wait. Script-scope so the
# message printed when it gives up can name the same number the loop used.
$CheckErrorLimit = 5

function Get-CheckRuns {
    param([string]$Slug, [string]$Sha)
    $headers = @{ 'User-Agent' = 'gaitdesk-release'; 'Accept' = 'application/vnd.github+json' }
    # A token lifts GitHub's 60/hour unauthenticated limit. Optional on purpose:
    # the poll below stays well inside 60, and a rate-limited answer warns
    # rather than failing a release that has already been pushed.
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
    # Returns a result object rather than the runs, so the caller can tell "the
    # request failed" from "the commit has no checks yet". Collapsing both to
    # $null is what let one blip end the wait, and what made the failure get
    # reported as a rate limit it was not.
    try {
        $runs = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Slug/commits/$Sha/check-runs" `
                                   -Headers $headers -TimeoutSec 25).check_runs
        return [pscustomobject]@{ Ok = $true; Runs = @($runs); Error = $null }
    } catch {
        return [pscustomobject]@{ Ok = $false; Runs = @(); Error = $_.Exception.Message }
    }
}

function Wait-ForChecks {
    param([string]$Slug, [string]$Sha, [int]$TimeoutMinutes = 15)

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $lastLine = ""
    # One failed request is not an answer. This call goes out to the open
    # internet, so a DNS blip, a proxy hiccup or the 25s timeout is an ordinary
    # event -- and giving up on the first one abandoned the whole 15-minute
    # budget over something that would have answered twenty seconds later. That
    # is exactly what happened releasing migration 138: the run reported
    # `unknown`, blamed the rate limit, and 59 of 60 anonymous requests were
    # still available. Several consecutive failures still end the wait, because
    # an API that is genuinely unreachable should not be polled for a quarter of
    # an hour.
    $errorStreak = 0
    $errorLimit  = $CheckErrorLimit
    $lastError   = ""
    while ((Get-Date) -lt $deadline) {
        $result = Get-CheckRuns -Slug $Slug -Sha $Sha
        if (-not $result.Ok) {
            $errorStreak++
            $lastError = $result.Error
            if ($errorStreak -ge $errorLimit) {
                return [pscustomobject]@{ State = 'unknown'; Failed = @(); Error = $lastError }
            }
            Write-Info "checks API unreachable ($errorStreak/$errorLimit), retrying -- $lastError"
            Start-Sleep -Seconds 20
            continue
        }
        $errorStreak = 0
        $runs = $result.Runs
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

        if ($failed.Count -gt 0)  { return [pscustomobject]@{ State = 'failed'; Failed = $failed; Error = $null } }
        if ($pending.Count -eq 0) { return [pscustomobject]@{ State = 'passed'; Failed = @(); Error = $null } }

        Start-Sleep -Seconds 20
    }
    return [pscustomobject]@{ State = 'timeout'; Failed = @(); Error = $null }
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

# ── Settings, 1Password ───────────────────────────────────────────────────────

# One named key out of .env, and nothing else. This script never loads .env the
# way migrate.ps1 does: DATABASE_URL there is dev, and a release that picked it
# up as production is the failure Test-IsProductionUrl exists to catch. The keys
# read through here are references and ids, not credentials.
function Get-DotEnvValue {
    param([string]$Name)
    $file = Join-Path $ScriptDir "../.env"
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in Get-Content $file) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# The environment wins over .env -- the same rule as migrate.ps1.
function Get-Setting {
    param([string]$Name)
    $v = [System.Environment]::GetEnvironmentVariable($Name)
    if ($v) { return $v.Trim().Trim('"').Trim("'") }
    return (Get-DotEnvValue $Name)
}

# winget adds the CLI's folder to PATH for processes started *after* the
# install, so an editor or terminal already open at the time never sees `op`
# and every 1Password read fails as "not installed" on a machine that has it.
function Find-OpCli {
    $cmd = Get-Command op -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (-not $env:LOCALAPPDATA) { return $null }
    $candidates = @(Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\op.exe")
    $candidates += @(
        Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Directory `
                      -Filter "AgileBits.1Password.CLI*" -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName "op.exe" }
    )
    return ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}

function Read-OpSecret {
    param([string]$Ref, [string]$What)
    $op = Find-OpCli
    if (-not $op) {
        Stop-Release "A 1Password reference is set for $What, but the 1Password CLI is not installed." @(
            "  winget install AgileBits.1Password.CLI",
            "then Settings > Developer > Integrate with 1Password CLI in the desktop app."
        )
    }
    Write-Info "reading $What from 1Password ($Ref)"
    # No 2>&1: in PowerShell 5.1 redirecting a native command's stderr wraps
    # each line in an ErrorRecord and trips $ErrorActionPreference.
    $value = (& $op read $Ref | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $value) {
        Stop-Release "1Password did not return $What for $Ref." @(
            "Check the reference (op://Vault/Item/field) and that the app is unlocked."
        )
    }
    return $value
}

# ── Neon backup branch ────────────────────────────────────────────────────────
#
# The backup used to be a console action that -BackedUp took on trust, and a
# flag somebody has to remember to be honest about is not a backup. This makes
# the branch itself: one API call, cut from whichever branch owns the production
# endpoint, just before production is migrated.

$NeonApi = "https://console.neon.tech/api/v2"

# A result object rather than a throw, so every caller can print what Neon said
# through Stop-Release. The key only ever travels in the header.
function Invoke-Neon {
    param([string]$Path, [string]$Method = 'GET', $Body = $null)
    $request = @{
        Method     = $Method
        Uri        = "$NeonApi$Path"
        Headers    = @{ Authorization = "Bearer $script:NeonApiKey"; Accept = 'application/json' }
        TimeoutSec = 30
    }
    if ($null -ne $Body) {
        $request.Body        = ($Body | ConvertTo-Json -Depth 6)
        $request.ContentType = 'application/json'
    }
    for ($attempt = 1; ; $attempt++) {
        try {
            return [pscustomobject]@{ Ok = $true; Status = 200; Data = (Invoke-RestMethod @request); Error = $null }
        } catch {
            $status = 0
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            $detail = $_.ErrorDetails.Message
            if (-not $detail) { $detail = $_.Exception.Message }
            try { $m = ($detail | ConvertFrom-Json).message; if ($m) { $detail = $m } } catch { }
            # 423: another operation is running on the project, which Neon
            # serialises. Ordinary on a busy project and gone in seconds.
            if ($status -eq 423 -and $attempt -lt 6) { Start-Sleep -Seconds 5; continue }
            return [pscustomobject]@{ Ok = $false; Status = $status; Data = $null; Error = $detail }
        }
    }
}

# Which Neon branch production is, asked of Neon rather than configured. The
# compute endpoint's id is the first label of the connection host
# (ep-xxx.c-2.us-east-2.aws.neon.tech), and the endpoint knows its branch -- so
# the backup is cut from the database this release is about to migrate, and
# there is no branch id sitting in a config file waiting to go stale.
function Get-NeonBranchForHost {
    param([string]$DbHost)
    $endpointId = (($DbHost -split '\.')[0]) -replace '-pooler$', ''
    $ep = Invoke-Neon -Path "/projects/$script:NeonProjectId/endpoints/$endpointId"
    if (-not $ep.Ok) {
        Stop-Release "Neon could not find endpoint $endpointId in project $($script:NeonProjectId) (HTTP $($ep.Status))." @(
            "Neon said: $($ep.Error)",
            "",
            "Check NEON_PROJECT_ID, and that the API key can see that project.",
            "Nothing has been changed."
        )
    }
    $branchId = $ep.Data.endpoint.branch_id
    $br = Invoke-Neon -Path "/projects/$script:NeonProjectId/branches/$branchId"
    if (-not $br.Ok) {
        Stop-Release "Neon could not read branch $branchId (HTTP $($br.Status))." @("Neon said: $($br.Error)")
    }
    return [pscustomobject]@{ Id = $branchId; Name = $br.Data.branch.name }
}

# No compute is asked for: a backup needs none until the day somebody restores
# from it, and one would bill for every hour it sat idle. A branch left by an
# earlier run of this same release is kept rather than duplicated -- it was cut
# before this release migrated anything, so it is the better backup of the two.
function New-NeonBackupBranch {
    param([string]$ParentId, [string]$Name, [int]$Days)

    $found = Invoke-Neon -Path "/projects/$script:NeonProjectId/branches?search=$([uri]::EscapeDataString($Name))"
    if ($found.Ok) {
        $existing = @($found.Data.branches) |
            Where-Object { $_.name -eq $Name -and $_.parent_id -eq $ParentId } |
            Select-Object -First 1
        if ($existing) {
            return [pscustomobject]@{ Id = $existing.id; Name = $existing.name; Expires = $existing.expires_at; Reused = $true }
        }
    }

    $expires = (Get-Date).ToUniversalTime().AddDays($Days).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $made = Invoke-Neon -Method POST -Path "/projects/$script:NeonProjectId/branches" -Body @{
        branch = @{ parent_id = $ParentId; name = $Name; expires_at = $expires }
    }
    if (-not $made.Ok) {
        Stop-Release "Neon refused the backup branch (HTTP $($made.Status))." @(
            "Neon said: $($made.Error)",
            "",
            "Production has NOT been migrated. Make the branch in the console and",
            "re-run with -BackedUp, or fix the cause and re-run."
        )
    }
    $id = $made.Data.branch.id

    # The API answers once the branch is recorded; wait until Neon calls it
    # ready, so "backed up" is something Neon has said rather than assumed.
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
        $state = Invoke-Neon -Path "/projects/$script:NeonProjectId/branches/$id"
        if ($state.Ok -and $state.Data.branch.current_state -eq 'ready') {
            return [pscustomobject]@{ Id = $id; Name = $Name; Expires = $expires; Reused = $false }
        }
        Start-Sleep -Seconds 3
    }
    Stop-Release "Backup branch $Name ($id) was created but never reported ready." @(
        "Production has NOT been migrated. Check the branch in the Neon console."
    )
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

# What the release would use, worked out WITHOUT reading a secret: a dry run
# must not pop a 1Password unlock dialog, and must not need the credentials it
# is only describing.
$prodUrlPlan = $null
if ($DatabaseUrl)                                { $prodUrlPlan = "-DatabaseUrl" }
elseif ($env:PRODUCTION_DATABASE_URL)            { $prodUrlPlan = "PRODUCTION_DATABASE_URL" }
elseif (Get-Setting 'PROD_DATABASE_URL_OP_REF')  { $prodUrlPlan = "1Password (PROD_DATABASE_URL_OP_REF)" }

$neonKeyPlan = $null
if ($env:NEON_API_KEY)                           { $neonKeyPlan = "NEON_API_KEY" }
elseif (Get-Setting 'NEON_API_KEY_OP_REF')       { $neonKeyPlan = "1Password (NEON_API_KEY_OP_REF)" }
$neonProjectPlan = Get-Setting 'NEON_PROJECT_ID'
$autoBackup = (-not $BackedUp) -and $neonKeyPlan -and $neonProjectPlan

# pre-<first migration number>-<commit>: says which release it guards, and is
# the same on a re-run of that release, which is what lets a re-run keep it.
$backupName = $null
if ($carriesSchema) {
    $firstMigration = ($reports | Sort-Object Name | Select-Object -First 1).Name
    $backupName = "pre-" + ($firstMigration -replace '^(\d+).*$', '$1') + "-" + (git rev-parse --short HEAD).Trim()
}

Write-Head "Plan"
$step = 0
if ($carriesSchema)  { $step++; Write-Info "$step. migrate DEV      (database/migrate.ps1)" }
if (-not $SkipTests) { $step++; Write-Info "$step. bash RUN_TESTS.sh" }
if ($carriesSchema) {
    $step++
    if ($BackedUp)       { Write-Info "$step. back up production: you branched it by hand (-BackedUp)" }
    elseif ($autoBackup) { Write-Info "$step. back up production: Neon branch $backupName, expires in $BackupDays days" }
    else                 { Write-Info "$step. back up production: NOT CONFIGURED -- see below" }
}
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
        Write-Info ""
        Write-Info "This release carries schema, so it needs production's URL and a backup:"
        if ($prodUrlPlan) { Write-Ok "production URL from $prodUrlPlan" }
        else {
            Write-Warn "no production URL: set PROD_DATABASE_URL_OP_REF in .env, or"
            Write-Info "  `$env:PRODUCTION_DATABASE_URL, or pass -DatabaseUrl"
        }
        if ($BackedUp)       { Write-Ok "backup: -BackedUp (branched by hand)" }
        elseif ($autoBackup) { Write-Ok "backup: made through the Neon API (key from $neonKeyPlan, project $neonProjectPlan)" }
        else {
            if (-not $neonKeyPlan)     { Write-Warn "no Neon API key: set NEON_API_KEY_OP_REF in .env, or `$env:NEON_API_KEY" }
            if (-not $neonProjectPlan) { Write-Warn "no Neon project: set NEON_PROJECT_ID in .env" }
            Write-Info "  or branch production in the Neon console and pass -BackedUp"
        }
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

# $env:PRODUCTION_DATABASE_URL and 1Password are the better ways in: a
# connection string passed as a command-line argument is written to
# PSReadLine's on-disk history (ConsoleHost_history.txt) in clear text,
# password and all. The URL itself is deliberately NOT read from .env -- .env is
# dev, and keeping production out of it is the whole point of the branch split.
# A 1Password reference there is fine: it is not a credential, and what it
# resolves to still has to pass Test-IsProductionUrl below.
#
# Only read when the release carries a migration, so a code-only release never
# asks anybody to unlock anything.
if ($DatabaseUrl) {
    $urlSource = "-DatabaseUrl"
} elseif ($env:PRODUCTION_DATABASE_URL) {
    $DatabaseUrl = $env:PRODUCTION_DATABASE_URL
    $urlSource = "PRODUCTION_DATABASE_URL"
} elseif ($carriesSchema -and (Get-Setting 'PROD_DATABASE_URL_OP_REF')) {
    Write-Head "Credentials"
    Write-Info "The first 1Password read of a session asks to unlock -- approve it at"
    Write-Info "the machine, or this waits. Both reads happen now, before anything runs."
    $DatabaseUrl = Read-OpSecret -Ref (Get-Setting 'PROD_DATABASE_URL_OP_REF') -What "the production URL"
    $urlSource = "1Password (PROD_DATABASE_URL_OP_REF)"
}

if ($carriesSchema -and -not $DatabaseUrl) {
    Stop-Release "This release carries a migration but no production URL." @(
        "Production is a different Neon branch; pushing without migrating it",
        "ships code against a schema that has not moved. One of:",
        "",
        "  PROD_DATABASE_URL_OP_REF=op://Vault/Item/field    in .env",
        "  `$env:PRODUCTION_DATABASE_URL = ""<production connection string>""",
        "  -DatabaseUrl ""<production connection string>""",
        "",
        "The first two keep the password out of PowerShell's on-disk command",
        "history. Do not repoint .env's DATABASE_URL at production instead --",
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

# The backup. Worked out here, before dev or the tests are touched, so a bad key
# or a wrong project id fails in seconds rather than after RUN_TESTS.sh. Only
# the lookup happens now; the branch itself is cut immediately before production
# is migrated, so it is as close to the pre-release state as it can be.
$prodBranch = $null
if ($carriesSchema -and $BackedUp) {
    Write-Head "Backup"
    Write-Warn "-BackedUp given: taking your word that production was branched by hand."
} elseif ($carriesSchema) {
    $script:NeonProjectId = Get-Setting 'NEON_PROJECT_ID'
    $script:NeonApiKey = $env:NEON_API_KEY
    if (-not $script:NeonApiKey -and (Get-Setting 'NEON_API_KEY_OP_REF')) {
        $script:NeonApiKey = Read-OpSecret -Ref (Get-Setting 'NEON_API_KEY_OP_REF') -What "the Neon API key"
    }
    if (-not $script:NeonApiKey -or -not $script:NeonProjectId) {
        Stop-Release "Production has not been backed up, and this script cannot do it yet." @(
            "To let it cut the backup branch itself (once, then every release):",
            "  NEON_API_KEY_OP_REF=op://Vault/Item/field    in .env (or `$env:NEON_API_KEY)",
            "  NEON_PROJECT_ID=<project id>                 in .env",
            "",
            "Or branch production by hand -- Neon console -> Branches > New branch,",
            "from production -- and re-run with -BackedUp."
        )
    }
    Write-Head "Backup"
    $prodBranch = Get-NeonBranchForHost $target.Host
    Write-Ok "production is Neon branch '$($prodBranch.Name)' ($($prodBranch.Id))"
    Write-Info "$backupName will be cut from it just before production is migrated."
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

    # Git Bash by preference, and by name rather than through PATH. On Windows
    # `bash` resolves to C:\WINDOWS\system32\bash.exe -- the WSL launcher --
    # and RUN_TESTS.sh runs its backend suite through Docker Desktop's *Windows*
    # CLI. Inside WSL `docker` is the Linux client talking to
    # /var/run/docker.sock, which is absent unless that distro has Docker
    # Desktop's WSL integration switched on. It reports the backend image as
    # missing, RUN_TESTS.sh fails the backend check, and the release stops on a
    # suite that passes perfectly well from Git Bash. The failure names the
    # image, so it reads as a stale build rather than as the wrong shell.
    $bash = @(
        (Join-Path $env:ProgramFiles "Git\bin\bash.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Git\bin\bash.exe")
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $bash) {
        $onPath = Get-Command bash -ErrorAction SilentlyContinue
        if ($onPath) {
            $bash = $onPath.Source
            Write-Warn "Git Bash not found; using $bash"
            Write-Info "If the backend check reports a missing image, this is why."
        }
    }
    if (-not $bash) {
        Stop-Release "bash not found; cannot run RUN_TESTS.sh." @(
            "Run the suite yourself and re-run with -SkipTests."
        )
    }
    & $bash "RUN_TESTS.sh"
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

    if ($prodBranch) {
        Write-Head "Backing up production"
        $backup = New-NeonBackupBranch -ParentId $prodBranch.Id -Name $backupName -Days $BackupDays
        if ($backup.Reused) {
            Write-Ok "kept $($backup.Name) ($($backup.Id)) from an earlier run of this release"
        } else {
            Write-Ok "branched $($backup.Name) ($($backup.Id)) from '$($prodBranch.Name)'"
        }
        Write-Info "expires $($backup.Expires). If this migration has to be undone, restore"
        Write-Info "'$($prodBranch.Name)' from $($backup.Name) in the Neon console."
    }

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
    Write-Warn "could not read the checks API after $CheckErrorLimit attempts."
    if ($checks.Error) { Write-Info "last error: $($checks.Error)" }
    # Do not guess at the cause. This used to say "rate limit, or no network",
    # which sent the reader after a token when the limit was barely touched.
    Write-Info "Check the run by hand before walking away:"
    Write-Info "  https://github.com/$slug/commits/$head"
    Write-Info "A token in GITHUB_TOKEN lifts the 60/hour anonymous limit, which"
    Write-Info "is worth having but is only one of the things that can cause this."
} else {
    Write-Ok "all checks green -- Render is building now"
}

# ══ 10b. Did the new build actually reach production? ═════════════════════════

# Whether a build swap was actually *observed*, as against merely hoped for. The
# closing summary reads this rather than asserting it -- see the CI note there.
$buildConfirmed = $false

if ($touchesWeb -or $touchesApi) {
    Write-Head "Waiting for the new build to serve"
    Write-Info "Comparing what production serves now against what it served before the push."

    if ($touchesWeb) {
        if ($null -eq $webBefore) {
            Write-Warn "no pre-push frontend fingerprint -- cannot confirm the web service."
        } elseif (Wait-ForFingerprint -Label "gaitdesk.com" -Before $webBefore -Probe { Get-WebFingerprint }) {
            $buildConfirmed = $true
        } else {
            Write-Warn "frontend assets unchanged after 12 minutes."
            Write-Info "Either the build is slow, or Render never started it. Check the"
            Write-Info "gaitdesk-web service in the Render dashboard before assuming it shipped."
        }
    }
    if ($touchesApi) {
        if ($null -eq $apiBefore) {
            Write-Warn "no pre-push API fingerprint -- cannot confirm the api service."
        } elseif (Wait-ForFingerprint -Label "api.gaitdesk.com" -Before $apiBefore -Probe { Get-ApiFingerprint }) {
            $buildConfirmed = $true
        } else {
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
# Only claim what was actually observed. This block used to assert CI went green
# unconditionally -- including on the run where the checks API could not be read
# at all, which is the one time the reader most needs to be told otherwise.
if ($checks.State -eq 'passed') {
    Write-Info "  * CI went green            -- without it Render never builds at all"
} else {
    Write-Info "  * CI was NOT read          -- verify it by hand; see above"
}
if ($buildConfirmed) {
    Write-Info "  * the new build is serving -- what production returns actually changed"
} elseif ($touchesWeb -or $touchesApi) {
    Write-Info "  * the build swap was NOT confirmed -- check Render before assuming it shipped"
} else {
    Write-Info "  * no build swap to confirm -- this release touched neither service"
}
Write-Host ""

# The push already happened, so this is not "the release failed" -- it is "the
# release went out and production is unhappy", which a caller still has to be
# able to tell apart from a clean one. Exiting 0 over printed FAIL lines is how
# a wrapper, or a tired human, reads an outage as a success.
if (-not $clean) { exit 1 }
