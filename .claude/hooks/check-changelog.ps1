# PreToolUse hook: git commit 前检查 CHANGELOG.md 是否已 staged
# 如果执行的是 git commit（非 --amend），但 CHANGELOG.md 不在 staged files 中，则阻止提交

$jsonInput = [Console]::In.ReadToEnd()
if (-not $jsonInput) { exit 0 }

$data = $jsonInput | ConvertFrom-Json
$command = $data.tool_input.command
if (-not $command) { exit 0 }

# 检查是否是 git commit 命令（排除 git commit --amend）
if ($command -notmatch 'git\s+commit') { exit 0 }
if ($command -match 'git\s+commit\s+.*--amend') { exit 0 }

# 获取项目根目录
$projectRoot = $data.cwd
if (-not $projectRoot) { exit 0 }

# 检查 CHANGELOG.md 是否在 staged files 中
Push-Location $projectRoot
$stagedFiles = & git diff --cached --name-only 2>&1
Pop-Location

if ($stagedFiles -match 'CHANGELOG\.md') {
    # CHANGELOG.md 已 staged，放行
    exit 0
}

# CHANGELOG.md 未 staged，阻止提交
$result = @{
    decision = "block"
    reason = "CHANGELOG.md 未包含在本次提交中。请先更新 CHANGELOG.md 再提交。"
} | ConvertTo-Json -Compress

Write-Output $result
