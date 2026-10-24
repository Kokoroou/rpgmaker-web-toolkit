# rpgmaker-web-toolkit: run without cloning. Downloads the toolkit into a temp
# folder, installs wrangler, runs the CLI, then deletes the temp folder.
#
#   irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
#
# With arguments (another command, or the game path):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))) import-saves "D:\Games\My Game"
#
# $env:RWK_REF selects a branch or tag (default: main).

# Everything runs in a child scope so `iex` leaves no variables or
# preferences behind in the caller's session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
  $repo = 'Kokoroou/rpgmaker-web-toolkit'
  $ref = if ($env:RWK_REF) { $env:RWK_REF } else { 'main' }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 24 or newer is required. Install it with: winget install OpenJS.NodeJS.LTS (then reopen the terminal).' -ForegroundColor Red
    return
  }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('rwk-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    Write-Host "Downloading rpgmaker-web-toolkit ($ref)..." -ForegroundColor Cyan
    $zip = Join-Path $work 'toolkit.zip'
    Invoke-WebRequest "https://codeload.github.com/$repo/zip/$ref" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $work
    $root = (Get-ChildItem -Path $work -Directory | Select-Object -First 1).FullName

    Write-Host 'Installing wrangler (faster next time thanks to the npm cache)...' -ForegroundColor Cyan
    # npm.cmd, not npm: the npm.ps1 shim is blocked under the default execution policy.
    & npm.cmd ci --prefix $root --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE) { throw "npm ci failed (exit code $LASTEXITCODE)" }

    & node (Join-Path $root 'cli\index.js') @args
  } finally {
    Write-Host 'Cleaning up the temp folder...' -ForegroundColor DarkGray
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
} @args
