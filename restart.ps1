# AgentClaw Gateway 重启脚本
# 用法: .\restart.ps1          — 构建 + 重启
#       .\restart.ps1 -NoBuild — 跳过构建，直接重启

param([switch]$NoBuild)

$Port = 3100

# 1. 查找并杀掉占用端口的进程
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $pid = $conn.OwningProcess | Select-Object -First 1
    Write-Host "[1/3] Stopping process $pid on port $Port..." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
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
Write-Host "[3/3] Starting gateway..." -ForegroundColor Green
Start-Process -FilePath "node" -ArgumentList "packages/gateway/dist/index.js" -WindowStyle Hidden
Start-Sleep -Seconds 2

$check = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "Gateway running on port $Port (PID: $($check.OwningProcess | Select-Object -First 1))" -ForegroundColor Green
} else {
    Write-Host "Gateway failed to start!" -ForegroundColor Red
}
