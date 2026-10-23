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

if not exist "%RWK_HOME%node_modules\wrangler\bin\wrangler.js" (
  echo [rwk] Installing dependencies (first run)...
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
