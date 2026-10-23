# rpgmaker-web-toolkit: chạy không cần clone. Tải toolkit vào thư mục tạm,
# cài wrangler, chạy CLI rồi xoá sạch thư mục tạm.
#
#   irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1 | iex
#
# Truyền tham số (vd: lệnh khác hoặc đường dẫn game):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Kokoroou/rpgmaker-web-toolkit/main/run.ps1))) import-saves "D:\Games\Game"
#
# $env:RWK_REF chọn nhánh hoặc tag (mặc định main).

# Everything runs in a child scope so `iex` leaves no variables or
# preferences behind in the caller's session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
  $repo = 'Kokoroou/rpgmaker-web-toolkit'
  $ref = if ($env:RWK_REF) { $env:RWK_REF } else { 'main' }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Cần Node.js 20 trở lên. Cài bằng: winget install OpenJS.NodeJS.LTS (rồi mở lại terminal).' -ForegroundColor Red
    return
  }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('rwk-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    Write-Host "Tải rpgmaker-web-toolkit ($ref)..." -ForegroundColor Cyan
    $zip = Join-Path $work 'toolkit.zip'
    Invoke-WebRequest "https://codeload.github.com/$repo/zip/$ref" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $work
    $root = (Get-ChildItem -Path $work -Directory | Select-Object -First 1).FullName

    Write-Host 'Cài wrangler (lần sau nhanh hơn nhờ cache của npm)...' -ForegroundColor Cyan
    # npm.cmd, not npm: the npm.ps1 shim is blocked under the default execution policy.
    & npm.cmd ci --prefix $root --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE) { throw "npm ci thất bại (mã $LASTEXITCODE)" }

    & node (Join-Path $root 'cli\index.js') @args
  } finally {
    Write-Host 'Dọn thư mục tạm...' -ForegroundColor DarkGray
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
} @args
