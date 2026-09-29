# One-line install for Windows (roadmap #56), in PowerShell:
#   irm https://raw.githubusercontent.com/gjohnsonmb1-afk/roost/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Repo = if ($env:ROOST_REPO) { $env:ROOST_REPO } else { 'https://github.com/gjohnsonmb1-afk/roost.git' }
$Dir = if ($env:ROOST_DIR) { $env:ROOST_DIR } else { Join-Path $HOME 'roost' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'Roost needs git: https://git-scm.com/download/win'; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Roost needs Node 20+: https://nodejs.org'; exit 1 }
if (Test-Path (Join-Path $Dir '.git')) {
  Write-Host "Updating Roost in $Dir"; git -C $Dir pull --ff-only
} else {
  Write-Host "Downloading Roost to $Dir"; git clone --depth 1 $Repo $Dir
}
Set-Location $Dir
node scripts/setup.mjs
