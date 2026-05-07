param(
    [Parameter(Mandatory = $false)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

function Run-Git {
    param([string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE."
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

Run-Git @("status", "--short")
Run-Git @("add", "-A")

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

Run-Git @("commit", "-m", $Message)
Run-Git @("push", "origin", "main")

Write-Host "Done. Changes committed and pushed to origin/main."

