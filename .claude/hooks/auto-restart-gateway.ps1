# PostToolUse hook: 构建命令完成后自动重启 gateway
# 当执行了 npm run build / turbo / tsup 命令后，检查端口 3100 是否有 gateway 在运行
# 如果有则 kill 并重新启动

$jsonInput = [Console]::In.ReadToEnd()
if (-not $jsonInput) { exit 0 }

$data = $jsonInput | ConvertFrom-Json
$command = $data.tool_input.command
if (-not $command) { exit 0 }

# 检查是否是构建命令
if ($command -notmatch 'npm\s+run\s+build|turbo|tsup') { exit 0 }

# 获取项目根目录
$projectRoot = $data.cwd
if (-not $projectRoot) { exit 0 }

# 检查端口 3100 是否有进程在监听
try {
    $connections = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction Stop
} catch {
    # 没有进程监听 3100，无需重启
    exit 0
}

# Kill 占用 3100 端口的进程
foreach ($conn in $connections) {
    $pid = $conn.OwningProcess
    if ($pid -and $pid -ne 0) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
}

# 等待端口释放
Start-Sleep -Seconds 1

# 启动新的 gateway 进程
Start-Process -NoNewWindow -FilePath "node" `
    -ArgumentList "packages/gateway/dist/index.js" `
    -WorkingDirectory $projectRoot
