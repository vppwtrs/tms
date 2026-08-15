<#
  TMS Extractor — launcher
  เปิด server + เบราว์เซอร์ พอปิดหน้าต่างเบราว์เซอร์ server จะถูกปิดตามอัตโนมัติ
  ไม่ต้องเรียกโดยตรง — ดับเบิลคลิก "TMS Extractor.bat" แทน
#>

$ErrorActionPreference = 'Stop'

# ---------- บังคับ console เป็น UTF-8 ----------
# ไม่มีบรรทัดนี้ PowerShell 5.1 จะพ่นข้อความไทยออกมาเป็น ANSI แล้วอ่านไม่ออก
try {
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
  $OutputEncoding           = [Console]::OutputEncoding
} catch {}

# ---------- โหลด PATH ใหม่จาก registry ----------
# จำเป็นหลังติดตั้ง Node เพราะ process ที่รันอยู่ยังถือ PATH เดิมของตอนเปิด
function Sync-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($m, $u) | Where-Object { $_ }) -join ';'
}
Sync-Path

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root 'server.js'
$port   = 5173
$url    = "http://localhost:$port"

function Say($msg, $color = 'Gray') { Write-Host "  $msg" -ForegroundColor $color }

Write-Host ''
Write-Host '  TMS Extractor' -ForegroundColor Green
Write-Host '  ─────────────────────────────────────────' -ForegroundColor DarkGray

# ---------- ตรวจ Node ----------
# EXIT 10 = "ติดตั้งเสร็จแล้ว ขอให้ .bat เรียกตัวเองใหม่" (ดู TMS Extractor.bat)

function Install-Node {
  # 1) winget — ทางที่ดีที่สุด จัดการ UAC และ PATH ให้เอง
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say 'ติดตั้งผ่าน winget...' Cyan
    winget install -e --id OpenJS.NodeJS.LTS --source winget `
           --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0) { return $true }
    Say 'winget ไม่สำเร็จ — ลองวิธีดาวน์โหลด MSI แทน' DarkYellow
  }

  # 2) ดาวน์โหลด MSI จาก nodejs.org โดยตรง
  $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $ver  = 'v22.11.0'
  try {
    Say 'ตรวจเวอร์ชัน LTS ล่าสุด...'
    $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 20 |
            Where-Object { $_.lts } | Select-Object -First 1).version
    if ($lts) { $ver = $lts }
  } catch { Say "ตรวจเวอร์ชันไม่ได้ ใช้ $ver แทน" DarkYellow }

  $url = "https://nodejs.org/dist/$ver/node-$ver-$arch.msi"
  $msi = Join-Path $env:TEMP "node-$ver-$arch.msi"

  Say "ดาวน์โหลด $url" DarkGray
  try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest $url -OutFile $msi -UseBasicParsing -TimeoutSec 300
  } catch {
    Say "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)" Red
    return $false
  }

  $mb = [math]::Round((Get-Item $msi).Length / 1MB, 1)
  Say "ได้ไฟล์ $mb MB — เริ่มติดตั้ง (จะมีหน้าต่าง UAC ขออนุญาต)" Cyan
  try {
    $p = Start-Process msiexec.exe -Verb RunAs -Wait -PassThru `
                       -ArgumentList '/i', "`"$msi`"", '/qb', '/norestart'
    Remove-Item $msi -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { Say "ตัวติดตั้งจบด้วยรหัส $($p.ExitCode)" Red; return $false }
    return $true
  } catch {
    Say "เรียกตัวติดตั้งไม่สำเร็จ: $($_.Exception.Message)" Red
    return $false
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say 'ไม่พบ Node.js บนเครื่องนี้' Red
  Say 'โปรแกรมนี้ต้องใช้ Node.js จึงจะทำงานได้' DarkGray
  Write-Host ''
  Say 'จะติดตั้งให้อัตโนมัติจาก nodejs.org (เว็บทางการ) ขนาดราว 30 MB' DarkGray
  $ans = Read-Host '  ติดตั้งเลยไหม? [Y/n]'

  if ($ans -and $ans.Trim().ToLower() -notin @('y', 'yes', '')) {
    Say 'ยกเลิก — ติดตั้งเองได้จาก https://nodejs.org แล้วเปิดโปรแกรมนี้ใหม่' DarkGray
    Write-Host ''
    Read-Host '  กด Enter เพื่อปิด'
    exit 1
  }

  Write-Host ''
  if (-not (Install-Node)) {
    Write-Host ''
    Say 'ติดตั้งอัตโนมัติไม่สำเร็จ' Red
    Say 'ติดตั้งเองได้จาก https://nodejs.org (เลือก LTS) แล้วเปิดโปรแกรมนี้ใหม่' DarkGray
    Write-Host ''
    Read-Host '  กด Enter เพื่อปิด'
    exit 1
  }

  Sync-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Say 'ติดตั้งเสร็จแล้ว แต่ยังเรียก node ไม่ได้จากหน้าต่างนี้' DarkYellow
    Say 'ปิดหน้าต่างนี้แล้วเปิด TMS Extractor.bat ใหม่อีกครั้ง' DarkGray
    Write-Host ''
    Read-Host '  กด Enter เพื่อปิด'
    exit 1
  }

  Write-Host ''
  Say "ติดตั้ง Node.js สำเร็จ ($(node -v))" Green
  Say 'กำลังเริ่มโปรแกรมใหม่...' Cyan
  Start-Sleep -Milliseconds 900
  exit 10
}

# ---------- เก็บกวาด process ค้างจากรอบก่อน ----------
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*tms-extractor*server.js*' } |
    ForEach-Object {
      Say "ปิด server ที่ค้างอยู่ (PID $($_.ProcessId))" DarkYellow
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
    }
} catch {}

# ---------- เริ่ม server ----------
Say 'กำลังเริ่ม server...'
$srv = Start-Process -FilePath $node.Source `
                     -ArgumentList "`"$server`"" `
                     -WorkingDirectory $root `
                     -WindowStyle Hidden `
                     -PassThru

# รอจนพอร์ตพร้อม (สูงสุด ~15 วินาที)
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 250
  if ($srv.HasExited) { break }
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $port); $ready = $true; $c.Close(); break }
  catch { }
  finally { $c.Dispose() }
}

if (-not $ready) {
  Say "เริ่ม server ไม่สำเร็จ (พอร์ต $port ไม่ตอบสนอง)" Red
  Say 'อาจมีโปรแกรมอื่นใช้พอร์ตนี้อยู่ — ลองเปลี่ยนพอร์ตใน server.js' DarkGray
  if (-not $srv.HasExited) { try { Stop-Process -Id $srv.Id -Force } catch {} }
  Write-Host ''
  Read-Host '  กด Enter เพื่อปิด'
  exit 1
}
Say "server พร้อมที่ $url" Green

# ---------- หาเบราว์เซอร์ ----------
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$exe = $null
foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $exe = $c; break } }

# โปรไฟล์ชั่วคราว — จำเป็น ไม่งั้น chrome.exe จะโยนงานให้หน้าต่างเดิมแล้วจบทันที
# ทำให้รอปิดไม่ได้ (และจะไปปน session เบราว์เซอร์ปกติของผู้ใช้ด้วย)
$profileDir = Join-Path $env:TEMP ('tms-extractor-profile-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

$browser = $null
if ($exe) {
  Say ('เปิด ' + [IO.Path]::GetFileNameWithoutExtension($exe) + '...')
  $browser = Start-Process -FilePath $exe -PassThru -ArgumentList @(
    "--app=$url",
    "--user-data-dir=`"$profileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1500,950'
  )
}

Write-Host ''
if ($browser) {
  Say 'ปิดหน้าต่างเบราว์เซอร์เมื่อใช้เสร็จ — server จะปิดตามให้เอง' Cyan
  Write-Host ''
  $browser.WaitForExit()
  Say 'ปิดเบราว์เซอร์แล้ว'
} else {
  # ไม่เจอ Chrome/Edge — เปิดด้วยเบราว์เซอร์ default แล้วรอผู้ใช้สั่งปิดเอง
  Say 'ไม่พบ Chrome หรือ Edge — เปิดด้วยเบราว์เซอร์เริ่มต้นแทน' DarkYellow
  Start-Process $url
  Write-Host ''
  Read-Host '  ใช้เสร็จแล้วกด Enter ที่หน้าต่างนี้เพื่อปิด server'
}

# ---------- เก็บกวาด ----------
if ($srv -and -not $srv.HasExited) {
  try { Stop-Process -Id $srv.Id -Force -ErrorAction Stop; Say 'ปิด server แล้ว' Green } catch {}
}
if (Test-Path $profileDir) {
  try { Remove-Item $profileDir -Recurse -Force -ErrorAction Stop } catch {}
}

Write-Host ''
Start-Sleep -Milliseconds 700
