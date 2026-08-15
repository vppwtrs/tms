<#
  เตรียม Node.js ให้เครื่องที่ยังไม่มี — ไม่ต้องใช้สิทธิ์ admin

  ติดตั้งแบบ portable ลง %LOCALAPPDATA%\nodejs (พื้นที่ของผู้ใช้เอง)
  แล้วเพิ่มเข้า PATH ระดับ user เพื่อให้โปรเจกต์อื่นเรียกใช้ได้ด้วย

  เขียน path ของ node.exe ที่ใช้ได้ออกไฟล์ที่ -OutFile เพื่อให้ start.cmd
  อ่านต่อแล้วรันในหน้าต่างเดิมได้ทันที (ไม่ต้องปิด-เปิดใหม่)

  ตั้ง NODE_MIRROR ได้ถ้าออฟฟิศมี mirror ภายใน เช่น
      set NODE_MIRROR=https://npmmirror.com/mirrors/node
#>
param(
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # ปิดแถบของ Invoke-WebRequest — เราวาดเอง

# เวอร์ชันที่ล็อกไว้ ไม่ใช่ "LTS ล่าสุด" ลอย ๆ
# better-sqlite3 มี prebuilt binary เฉพาะบาง ABI — เวอร์ชันนอกลิสต์นี้จะไปคอมไพล์เอง
# ด้วย node-gyp ซึ่งต้องมี Visual Studio C++ (ต้อง admin) แล้วติดตั้งล้มทั้งงาน
$NODE_VERSION  = 'v22.23.2'
$ALLOWED_MAJOR = @(20, 22, 24)

$mirror  = if ($env:NODE_MIRROR) { $env:NODE_MIRROR.TrimEnd('/') } else { 'https://nodejs.org/dist' }
$arch    = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$homeDir = Join-Path $env:LOCALAPPDATA 'nodejs'
$npmDir  = Join-Path $env:APPDATA 'npm'

function Say($m)  { Write-Host $m }
function Ok($m)   { Write-Host "  $([char]0x2714) $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  $([char]0x2718) $m" -ForegroundColor Red; exit 1 }

# ---------- หา node ที่ใช้ได้อยู่แล้ว ----------

function Test-Node([string]$exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  try { $v = & $exe --version 2>$null } catch { return $false }
  if ($v -notmatch '^v(\d+)\.') { return $false }
  return $ALLOWED_MAJOR -contains [int]$Matches[1]
}

function Find-Node {
  # 1) ตัวที่อยู่ใน PATH
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Node $cmd.Source)) { return $cmd.Source }

  # 2) ตัว portable ที่สคริปต์นี้เคยลงไว้
  $local = Join-Path $homeDir 'node.exe'
  if (Test-Node $local) { return $local }

  # 3) ตัวที่ลงแบบ installer ไว้แต่ไม่ได้อยู่ใน PATH
  foreach ($p in @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
  )) { if (Test-Node $p) { return $p } }

  return $null
}

# ---------- ดาวน์โหลดพร้อมแถบ % ----------

function Get-FileWithProgress([string]$url, [string]$dest, [string]$label) {
  Add-Type -AssemblyName System.Net.Http
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromMinutes(15)
  try {
    $resp = $client.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).
              GetAwaiter().GetResult()
    if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode) จาก $url" }

    $total  = $resp.Content.Headers.ContentLength
    $inS    = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $outS   = [System.IO.File]::Create($dest)
    $buf    = New-Object byte[] 131072
    $done   = 0L
    $lastAt = 0

    try {
      while (($n = $inS.Read($buf, 0, $buf.Length)) -gt 0) {
        $outS.Write($buf, 0, $n)
        $done += $n
        # วาดใหม่ทุก ๆ 1% พอ — ไม่งั้นหน้าจอกระพริบ
        $pct = if ($total) { [int](100 * $done / $total) } else { 0 }
        if ($pct -ne $lastAt -or -not $total) {
          $lastAt = $pct
          Write-Progress-Bar $label $pct $done $total
        }
      }
    } finally { $outS.Dispose(); $inS.Dispose() }

    Write-Progress-Bar $label 100 $done $total
    Write-Host ''
  } finally { $client.Dispose() }
}

function Write-Progress-Bar([string]$label, [int]$pct, [long]$done, $total) {
  $width  = 28
  $fill   = [int]($width * $pct / 100)
  $bar    = ('#' * $fill) + ('.' * ($width - $fill))
  $size   = if ($total) { '{0,6:N1} / {1,6:N1} MB' -f ($done/1MB), ($total/1MB) }
            else        { '{0,6:N1} MB' -f ($done/1MB) }
  Write-Host ("`r  {0} [{1}] {2,3}%  {3}" -f $label, $bar, $pct, $size) -NoNewline
}

# ---------- ติดตั้ง ----------

function Install-Node {
  $name    = "node-$NODE_VERSION-win-$arch"
  $zipUrl  = "$mirror/$NODE_VERSION/$name.zip"
  $sumUrl  = "$mirror/$NODE_VERSION/SHASUMS256.txt"
  $tmp     = Join-Path $env:TEMP ("tms-node-" + [guid]::NewGuid().ToString('N').Substring(0,8))
  $zip     = Join-Path $tmp "$name.zip"

  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Say ''
    Say "  กำลังติดตั้ง Node.js $NODE_VERSION ($arch) — ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ"
    Say "  ปลายทาง: $homeDir"
    Say ''

    try { Get-FileWithProgress $zipUrl $zip 'ดาวน์โหลด' }
    catch {
      Write-Host ''
      Die "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)`n     ถ้าออฟฟิศบล็อก nodejs.org ให้ตั้ง NODE_MIRROR ชี้ไป mirror ภายในก่อนรันใหม่"
    }

    # ตรวจว่าไฟล์ที่ได้ตรงกับที่ nodejs.org ประกาศไว้ กันไฟล์เสีย/โดนแก้กลางทาง
    Say '  ตรวจสอบความถูกต้องของไฟล์...'
    $want = ((Invoke-WebRequest $sumUrl -TimeoutSec 60).Content -split "`n" |
             Where-Object { $_ -match [regex]::Escape("$name.zip") }) -split '\s+' | Select-Object -First 1
    $got  = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $want) { Warn 'ไม่พบ checksum จาก mirror — ข้ามการตรวจสอบ' }
    elseif ($want -ne $got) { Die "ไฟล์ที่ดาวน์โหลดมาไม่ตรง checksum — ยกเลิกเพื่อความปลอดภัย" }
    else { Ok 'ไฟล์ถูกต้อง' }

    Say '  แตกไฟล์...'
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    if (Test-Path $homeDir) { Remove-Item $homeDir -Recurse -Force }
    Move-Item (Join-Path $tmp $name) $homeDir
    Ok "ติดตั้งแล้ว: $homeDir"
  }
  finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }

  $exe = Join-Path $homeDir 'node.exe'
  if (-not (Test-Node $exe)) { Die 'ติดตั้งเสร็จแต่เรียก node ไม่ขึ้น' }
  return $exe
}

# เพิ่มเข้า PATH ของผู้ใช้ (ไม่ใช่ของเครื่อง — จึงไม่ต้องขอสิทธิ์ admin)
# ผลคือโปรเจกต์อื่นบนเครื่องนี้เรียก node/npm ได้ด้วย
function Register-Path {
  $cur   = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $cur) { $cur = '' }
  $parts = @($cur -split ';' | Where-Object { $_ })
  $added = $false
  foreach ($p in @($homeDir, $npmDir)) {
    if ($parts -notcontains $p) { $parts += $p; $added = $true }
  }
  if ($added) {
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
    Ok 'เพิ่ม Node.js เข้า PATH ของผู้ใช้แล้ว — โปรเจกต์อื่นบนเครื่องนี้ใช้ได้ด้วย'
  }
}

# ---------- main ----------

$node = Find-Node
if ($node) {
  $ver = & $node --version
  Ok "พบ Node.js $ver อยู่แล้ว"
} else {
  $node = Install-Node
  Register-Path
  Say ''
}

if ($OutFile) { Set-Content -Path $OutFile -Value $node -Encoding ASCII -NoNewline }
exit 0
