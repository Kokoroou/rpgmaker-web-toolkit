# rpgmaker-web-toolkit: run without cloning. Downloads the toolkit and its wrangler once
# into a cache folder, then runs the CLI from it: the next run starts at once (it only
# asks GitHub which version `main` is on).
#
#   irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
#
# With arguments (a command and the game):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))) saves import "D:\Games\My Game"
#
# $env:RWK_REF selects a branch or tag (default: main). A tag is cached for good.
# $env:RWK_CACHE moves the cache (default: %LOCALAPPDATA%\rpgmaker-web-toolkit\cache).
#
# --cleanup (or $env:RWK_CLEANUP = '1') deletes the cached toolkit after the run, like a
# one-off run. It is left alone while another run still uses it: that run is not
# disturbed, and the last one to finish with --cleanup removes it. Not passed on to the CLI.

# Everything runs in a child scope so `iex` leaves no variables or
# preferences behind in the caller's session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
  $repo = 'Kokoroou/rpgmaker-web-toolkit'
  $ref = if ($env:RWK_REF) { $env:RWK_REF } else { 'main' }
  # Where the downloads come from (a test may point these elsewhere).
  $downloadBase = if ($env:RWK_DOWNLOAD_BASE) { $env:RWK_DOWNLOAD_BASE } else { "https://codeload.github.com/$repo" }
  $apiBase = if ($env:RWK_API_BASE) { $env:RWK_API_BASE } else { "https://api.github.com/repos/$repo" }

  $cleanup = [bool]$env:RWK_CLEANUP -and ($env:RWK_CLEANUP -notin @('0', 'false', 'no'))
  $cli = @()
  foreach ($arg in $args) {
    if ($arg -eq '--cleanup') { $cleanup = $true } else { $cli += $arg }
  }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 22 or newer is required. Install it with: winget install OpenJS.NodeJS.LTS (then reopen the terminal).' -ForegroundColor Red
    return
  }

  $cache = if ($env:RWK_CACHE) { $env:RWK_CACHE } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'rpgmaker-web-toolkit\cache' }
  $lockFile = Join-Path $cache '.lock'
  # State the functions below change (a function cannot assign to this scope's variables).
  $S = @{ locked = $false; lease = $null; verdir = $null }

  # --- A lock around the short steps that change the cache (publish, lease, remove, prune).
  # A file only one process can create; it holds the owner's pid, so one left by a dead
  # process is taken over. Downloads and installs run outside it.
  function Lock-Cache {
    $tries = 0
    while ($true) {
      try {
        $stream = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $bytes = [Text.Encoding]::ASCII.GetBytes([string]$PID)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Close()
        $S.locked = $true
        return
      } catch [IO.IOException] {
        # Taken: look at who holds it.
      }
      $owner = 0
      try { $owner = [int](Get-Content -LiteralPath $lockFile -ErrorAction Stop) } catch { $owner = 0 }
      $stale = $false
      if ($owner -gt 0 -and -not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { $stale = $true }
      else {
        $age = 0
        try { $age = ((Get-Date) - (Get-Item -LiteralPath $lockFile -ErrorAction Stop).LastWriteTime).TotalMinutes } catch { $age = 0 }
        if ($age -gt 2) { $stale = $true }
      }
      if ($stale) {
        Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
        continue
      }
      $tries++
      if ($tries -gt 600) { throw "Another run holds $lockFile. If none is running, delete that file." }
      Start-Sleep -Milliseconds 100
    }
  }
  function Unlock-Cache {
    if ($S.locked) { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }
    $S.locked = $false
  }

  # Each run leaves a file named after its pid in the version's .leases folder while it
  # uses it. Removing a version waits for the leases of live processes to end.
  function Test-LiveLease($dir) {
    $leases = Join-Path $dir '.leases'
    if (-not (Test-Path -LiteralPath $leases)) { return $false }
    foreach ($file in @(Get-ChildItem -LiteralPath $leases -File -ErrorAction SilentlyContinue)) {
      $leasePid = [int]($file.Name -split '\.')[0]
      if (Get-Process -Id $leasePid -ErrorAction SilentlyContinue) { return $true }
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue # a run that died without releasing
    }
    return $false
  }

  # node_modules is a junction into deps\: it is unlinked first, so removing the folder
  # never reaches the shared install (Remove-Item -Recurse may follow a junction).
  function Remove-Tree($dir) {
    $modules = Join-Path $dir 'node_modules'
    if (Test-Path -LiteralPath $modules) { try { [IO.Directory]::Delete($modules) } catch { } }
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }

  # Installs (wrangler) that no version uses any more; call with the lock held.
  function Remove-UnusedDeps {
    $used = @()
    foreach ($tk in @(Get-ChildItem -LiteralPath (Join-Path $cache 'toolkit') -Directory -ErrorAction SilentlyContinue)) {
      $marker = Join-Path $tk.FullName '.rwk-deps'
      if (Test-Path -LiteralPath $marker) { $used += (Get-Content -LiteralPath $marker -Raw).Trim() }
    }
    foreach ($dir in @(Get-ChildItem -LiteralPath (Join-Path $cache 'deps') -Directory -ErrorAction SilentlyContinue)) {
      if ($used -notcontains $dir.Name) { Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }

  # Older versions go, the newest few stay (a run on an old version may still be going).
  function Invoke-Prune {
    $versions = @(Get-ChildItem -LiteralPath (Join-Path $cache 'toolkit') -Directory | Sort-Object LastWriteTime -Descending)
    foreach ($dir in @($versions | Select-Object -Skip 3)) {
      if (-not (Test-LiveLease $dir.FullName)) { Remove-Tree $dir.FullName }
    }
    # What a run that was killed halfway left behind.
    foreach ($dir in @(Get-ChildItem -LiteralPath $cache -Directory -Filter 'tmp-*' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) })) {
      Remove-Tree $dir.FullName
    }
    Remove-UnusedDeps
  }

  # The version to run: key (the folder name in toolkit\) and src (what to download).
  # A tag never changes; for a branch GitHub tells which commit it is on now, and
  # without a network the last one downloaded is used.
  function Resolve-Version {
    $safe = $ref -replace '[^A-Za-z0-9._-]', '_'
    if ($ref -match '^v?\d+\.\d+\.\d+([-+.][0-9A-Za-z.-]+)?$') { return @{ key = "tag-$safe"; src = $ref } }
    $sha = ''
    try {
      $response = Invoke-WebRequest "$apiBase/commits/$ref" -Headers @{ Accept = 'application/vnd.github.sha' } -UseBasicParsing -TimeoutSec 15
      $sha = if ($response.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($response.Content) } else { [string]$response.Content }
      $sha = $sha.Trim()
    } catch { $sha = '' }
    if ($sha -match '^[0-9a-f]{40}$') {
      Set-Content -LiteralPath (Join-Path $cache "refs\$safe") -Value $sha -NoNewline -ErrorAction SilentlyContinue
      return @{ key = $sha; src = $sha }
    }
    $remembered = Join-Path $cache "refs\$safe"
    $last = if (Test-Path -LiteralPath $remembered) { (Get-Content -LiteralPath $remembered -Raw).Trim() } else { '' }
    if ($last -match '^[0-9a-f]{40}$' -and (Test-Path -LiteralPath (Join-Path $cache "toolkit\$last"))) {
      Write-Host "Could not ask GitHub about '$ref': using the copy already downloaded ($($last.Substring(0, 7)))." -ForegroundColor DarkGray
      return @{ key = $last; src = $last }
    }
    # No answer and nothing cached: download the branch by name, kept under a name of its own.
    return @{ key = "$safe-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"; src = $ref }
  }

  function Test-VersionReady($dir) {
    return (Test-Path -LiteralPath (Join-Path $dir 'cli\index.js')) -and (Test-Path -LiteralPath (Join-Path $dir 'node_modules\wrangler\bin\wrangler.js'))
  }

  # Makes the version ready in the cache and takes a lease on it.
  function Enter-Cache {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      $version = Resolve-Version
      $verdir = Join-Path $cache "toolkit\$($version.key)"
      $S.verdir = $verdir
      Lock-Cache
      if (-not (Test-VersionReady $verdir)) {
        Unlock-Cache
        if (Test-Path -LiteralPath $verdir) { # half there (an install cut short, or its wrangler pruned)
          Lock-Cache
          Remove-Tree $verdir
          Unlock-Cache
        }
        $stage = Join-Path $cache ('tmp-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $stage | Out-Null

        Write-Host "Downloading rpgmaker-web-toolkit ($ref)..." -ForegroundColor Cyan
        $zip = Join-Path $stage 'toolkit.zip'
        Invoke-WebRequest "$downloadBase/zip/$($version.src)" -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $stage
        Remove-Item -LiteralPath $zip -Force
        $root = (Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1).FullName
        if (-not (Test-Path -LiteralPath (Join-Path $root 'cli\index.js'))) { throw "Unexpected download: no cli\index.js (is '$ref' a valid branch or tag?)." }

        # wrangler and the other dependencies, installed once per package-lock.json and
        # shared by every version of the toolkit that has the same one.
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root 'package-lock.json')).Hash.ToLower()
        $depsFinal = Join-Path $cache "deps\$hash"
        $depsStage = $null
        if (-not (Test-Path -LiteralPath (Join-Path $depsFinal '.ready'))) {
          Write-Host 'Installing wrangler (kept for the next runs)...' -ForegroundColor Cyan
          $depsStage = Join-Path $stage 'deps-stage'
          New-Item -ItemType Directory -Path $depsStage | Out-Null
          Copy-Item -LiteralPath (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') -Destination $depsStage
          # npm.cmd, not npm: the npm.ps1 shim is blocked under the default execution policy.
          # Out-Host: npm's output is shown, not returned by this function with the path.
          & npm.cmd ci --prefix $depsStage --no-fund --no-audit --loglevel=error | Out-Host
          if ($LASTEXITCODE) { throw "npm ci failed (exit code $LASTEXITCODE)" }
          if (-not (Test-Path -LiteralPath (Join-Path $depsStage 'node_modules\wrangler\bin\wrangler.js'))) { throw 'npm ci did not install wrangler.' }
          New-Item -ItemType File -Path (Join-Path $depsStage '.ready') | Out-Null
        }

        Lock-Cache
        if ($depsStage -and -not (Test-Path -LiteralPath (Join-Path $depsFinal '.ready'))) {
          if (Test-Path -LiteralPath $depsFinal) { Remove-Item -LiteralPath $depsFinal -Recurse -Force }
          Move-Item -LiteralPath $depsStage -Destination $depsFinal
        }
        if (-not (Test-VersionReady $verdir)) {
          Set-Content -LiteralPath (Join-Path $root '.rwk-deps') -Value $hash -NoNewline
          # A junction needs no administrator rights, and its target exists by now.
          New-Item -ItemType Junction -Path (Join-Path $root 'node_modules') -Target (Join-Path $depsFinal 'node_modules') | Out-Null
          if (Test-Path -LiteralPath $verdir) { Remove-Tree $verdir }
          Move-Item -LiteralPath $root -Destination $verdir
        }
        Remove-Tree $stage
      }
      # The lock is held here (taken above, in either branch).
      if (Test-VersionReady $verdir) {
        $leases = Join-Path $verdir '.leases'
        New-Item -ItemType Directory -Path $leases -Force | Out-Null
        $S.lease = Join-Path $leases "$PID.$([guid]::NewGuid().ToString('N').Substring(0, 6))"
        New-Item -ItemType File -Path $S.lease | Out-Null
        (Get-Item -LiteralPath $verdir).LastWriteTime = Get-Date
        Invoke-Prune
        Unlock-Cache
        return $verdir
      }
      Unlock-Cache
    }
    throw 'Could not set up the toolkit in the cache.'
  }

  try {
    foreach ($sub in 'toolkit', 'deps', 'refs') { New-Item -ItemType Directory -Path (Join-Path $cache $sub) -Force | Out-Null }
    $verdir = Enter-Cache
    & node (Join-Path $verdir 'cli\index.js') @cli
  } finally {
    # The lease goes; with --cleanup the cached version goes too, unless another run is using it.
    $exitCode = $LASTEXITCODE
    try {
      Unlock-Cache
      if ($S.lease -or $cleanup) {
        Lock-Cache
        if ($S.lease) { Remove-Item -LiteralPath $S.lease -Force -ErrorAction SilentlyContinue }
        if ($cleanup -and $S.verdir -and (Test-Path -LiteralPath $S.verdir)) {
          if (Test-LiveLease $S.verdir) {
            Write-Host 'Another run is using the cached toolkit: it stays until that run ends.' -ForegroundColor DarkGray
          } else {
            Write-Host 'Cleaning up the cached toolkit...' -ForegroundColor DarkGray
            Remove-Tree $S.verdir
            Remove-UnusedDeps
          }
        }
        Unlock-Cache
      }
    } catch {
      Unlock-Cache
    }
    $global:LASTEXITCODE = $exitCode
  }
} @args
