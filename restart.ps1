# AgentClaw Gateway 重启脚本
# 用法: .\restart.ps1              — Node 构建 + 重启
#       .\restart.ps1 -NoBuild     — 跳过构建，Node 重启
#       .\restart.ps1 -Bun         — 构建 + Bun 重启
#       .\restart.ps1 -Bun -NoBuild — 跳过构建，Bun 重启

param([switch]$NoBuild, [switch]$Bun)

$Port = 3100

# 1. 查找并杀掉占用端口的进程
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $procId = $conn.OwningProcess | Select-Object -First 1
    Write-Host "[1/3] Stopping process $procId on port $Port..." -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    # 轮询等待端口释放（最多 10 秒）
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $still) { break }
    }
} else {
    Write-Host "[1/3] No process on port $Port, skipping." -ForegroundColor Gray
}

# 2. 构建
if (-not $NoBuild) {
    Write-Host "[2/3] Building..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[2/3] Skipping build (-NoBuild)." -ForegroundColor Gray
}

# 3. 后台启动 gateway
$runtime = if ($Bun) { "bun" } else { "node" }
Write-Host "[3/3] Starting gateway ($runtime)..." -ForegroundColor Green
Start-Process -FilePath $runtime -ArgumentList "packages/gateway/dist/index.js" -WindowStyle Hidden

# 轮询等待启动（最多 10 秒）
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $check = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($check) {
        Write-Host "Gateway running on port $Port (PID: $($check.OwningProcess | Select-Object -First 1))" -ForegroundColor Green
        exit 0
    }
}
Write-Host "Gateway failed to start!" -ForegroundColor Red
