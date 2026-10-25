@echo off
rem rpgmaker-web-toolkit launcher (Windows).
rem   rwk.cmd "D:\Games\My Game"
setlocal
set "RWK_HOME=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [rwk] Node.js not found. Install the LTS release from https://nodejs.org and run again.
  exit /b 1
)

rem Also after an update that added a dependency.
set "RWK_INSTALL="
if not exist "%RWK_HOME%node_modules\wrangler\bin\wrangler.js" set "RWK_INSTALL=1"
if not exist "%RWK_HOME%node_modules\lz-string\package.json" set "RWK_INSTALL=1"
if defined RWK_INSTALL (
  echo [rwk] Installing dependencies...
  pushd "%RWK_HOME%"
  call npm ci --no-fund --no-audit
  if errorlevel 1 (
    popd
    echo [rwk] npm ci failed.
    exit /b 1
  )
  popd
)

node "%RWK_HOME%cli\index.js" %*
exit /b %errorlevel%
