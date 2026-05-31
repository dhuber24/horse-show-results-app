param(
    [Parameter(Mandatory = $false)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

function Run-Git {
    param([string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    throw "Could not determine repository root."
}

Set-Location $repoRoot

$branch = (git branch --show-current).Trim()
if ($branch -ne "main") {
    throw "Refusing to push from branch '$branch'. Switch to 'main' or update this script intentionally."
}

Run-Git -GitArgs @("status", "--short")
Run-Git -GitArgs @("add", "-A")
if (Test-Path ".claude/scheduled_tasks.lock") {
    Run-Git -GitArgs @("restore", "--staged", "--", ".claude/scheduled_tasks.lock")
}

$guardScript = Join-Path $repoRoot "scripts/check-docs-updated.ps1"
if (-not (Test-Path $guardScript)) {
    throw "Documentation guard script not found at $guardScript"
}

powershell -ExecutionPolicy Bypass -File $guardScript
if ($LASTEXITCODE -ne 0) {
    throw "Documentation guard failed. Update docs or explicitly bypass for this commit."
}

if (-not $Message -or $Message.Trim() -eq "") {
    $Message = Read-Host "Commit message"
}

if (-not $Message -or $Message.Trim() -eq "") {
    throw "Commit message cannot be empty."
}

# Stream the message through a UTF-8 (no BOM) tempfile and `git commit -F`.
# PowerShell 5.1's `& git @args` splits multi-line strings on newlines when
# passing them to a native exe, which broke `-m "$Message"` for any commit
# with a body. Writing to a file with the explicit UTF8Encoding($false)
# constructor also dodges the PS 5.1 `Out-File -Encoding utf8` BOM, so the
# commit subject doesn't end up with a leading U+FEFF.
$tmpMsg = New-TemporaryFile
try {
    [System.IO.File]::WriteAllText(
        $tmpMsg.FullName,
        $Message,
        (New-Object System.Text.UTF8Encoding($false))
    )
    Run-Git -GitArgs @("commit", "-F", $tmpMsg.FullName)
} finally {
    Remove-Item $tmpMsg.FullName -Force -ErrorAction SilentlyContinue
}

Run-Git -GitArgs @("push", "origin", "main")

Write-Host "Done. Changes committed and pushed to origin/main."

