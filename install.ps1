# Install the Dstack skill for Claude Code (Windows).
#   ./install.ps1          directory junction (repo stays source of truth; git pull updates it)
#   ./install.ps1 -Copy    independent copy
param([switch]$Copy)

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src     = Join-Path $RepoDir "skill"
$DestDir = if ($env:CLAUDE_SKILLS_DIR) { $env:CLAUDE_SKILLS_DIR } else { Join-Path $env:USERPROFILE ".claude\skills" }
$Dest    = Join-Path $DestDir "dstack"

if (-not (Test-Path (Join-Path $Src "SKILL.md"))) {
  Write-Host "error: skill\SKILL.md not found." -ForegroundColor Red
  Write-Host "The skill is not built yet in this checkout. See docs\plans for what builds it."
  exit 1
}
if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Force -Path $DestDir | Out-Null }

if (Test-Path $Dest) {
  Write-Host "removing existing $Dest"
  # A junction must be removed with rmdir, not Remove-Item -Recurse, which can
  # follow the link and delete the repo contents on older PowerShell.
  cmd /c rmdir "$Dest" 2>$null
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
}

if ($Copy) {
  Copy-Item -Recurse $Src $Dest
  Write-Host "installed (copy) -> $Dest"
} else {
  cmd /c mklink /J "$Dest" "$Src" | Out-Null
  Write-Host "installed (junction) -> $Dest -> $Src"
}

Write-Host ""
Write-Host "Checking what Dstack can route to:"
# Some CLIs install to a per-user dir that is on the shell PATH Claude Code uses
# but not on PowerShell's, so probe known locations before declaring one missing.
$fallbacks = @{
  codex  = @("$env:USERPROFILE\.codex\bin\codex.exe",  "$env:USERPROFILE\.codex\bin\codex")
  grok   = @("$env:USERPROFILE\.grok\bin\grok.exe",    "$env:USERPROFILE\.grok\bin\grok")
  gemini = @("$env:USERPROFILE\.gemini\bin\gemini.exe","$env:USERPROFILE\.gemini\bin\gemini")
}
foreach ($cli in @("node","codex","grok","gemini","gh")) {
  $exe = (Get-Command $cli -ErrorAction SilentlyContinue).Source
  if (-not $exe -and $fallbacks.ContainsKey($cli)) {
    $exe = $fallbacks[$cli] | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if ($exe) {
    $ver = try { (& $exe --version 2>&1 | Select-Object -First 1) } catch { "installed" }
    "  {0,-7} {1}" -f $cli, $ver | Write-Host
  } else {
    "  {0,-7} not found (that route will be skipped, never silently passed)" -f $cli | Write-Host
  }
}

$verifier = Join-Path $Src "scripts\verify.cjs"
if ((Test-Path $verifier) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Verifying the installed skill is internally consistent:"
  Push-Location $Src
  try {
    & node "scripts\verify.cjs"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  verifier FAILED, the skill is not safe to use" -ForegroundColor Red
      exit 1
    }
  } finally { Pop-Location }
}

Write-Host ""
Write-Host "Done. Start Claude Code and run: /dstack intake <what you want built>"
Write-Host "Then copy dstack.config.example.json into your project as dstack.config.json."
exit 0
