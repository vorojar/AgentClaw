# PostToolUse hook: Edit|Write 后自动增量构建
# 当编辑了 packages/ 下的 .ts 源文件时，自动运行 npm run build（turbo 增量构建）
# 使用文件锁防抖：30 秒内只执行一次 build

$jsonInput = [Console]::In.ReadToEnd()
if (-not $jsonInput) { exit 0 }

$data = $jsonInput | ConvertFrom-Json
$filePath = $data.tool_input.file_path
if (-not $filePath) { exit 0 }

# 统一为正斜杠便于匹配
$normalized = $filePath -replace '\\', '/'

# 必须在 packages/ 下的 .ts 文件
if ($normalized -notmatch 'packages/.+\.ts$') { exit 0 }

# 排除 node_modules、dist、.d.ts
if ($normalized -match 'node_modules|/dist/') { exit 0 }
if ($normalized -match '\.d\.ts$') { exit 0 }

# 获取项目根目录
$projectRoot = $data.cwd
if (-not $projectRoot) { exit 0 }

# 防抖：文件锁机制
$lockFile = Join-Path $projectRoot ".claude/hooks/.build-lock"

if (Test-Path $lockFile) {
    $lockAge = (Get-Date) - (Get-Item $lockFile).CreationTime
    if ($lockAge.TotalSeconds -lt 30) {
        # 30 秒内已有 build 在进行或刚完成，跳过
        exit 0
    }
    # 锁文件超时，删除旧锁
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

# 创建锁文件
New-Item -ItemType File -Path $lockFile -Force | Out-Null

try {
    Push-Location $projectRoot
    & npm run build 2>&1 | Out-Null
    Pop-Location
} finally {
    # 无论成功失败都删除锁文件
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}
