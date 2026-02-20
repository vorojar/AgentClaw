# 爬爬虾任务前检查清单
# 在执行任何任务前运行此脚本

Write-Host "=== 爬爬虾任务前检查清单 ===" -ForegroundColor Cyan
Write-Host "运行时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
Write-Host ""

# 检查1：环境检测
Write-Host "[检查1] 系统环境检测..." -ForegroundColor Yellow
$isWindows = $PSVersionTable.PSVersion.Major -gt 0
if ($isWindows) {
    Write-Host "  ✓ 检测到Windows PowerShell环境" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 非Windows环境，注意脚本兼容性" -ForegroundColor Yellow
}

# 检查2：教训文件存在性
Write-Host "[检查2] 教训记录检查..." -ForegroundColor Yellow
$lessonsFile = ".\crawfish_lessons_learned.txt"
if (Test-Path $lessonsFile) {
    Write-Host "  ✓ 找到教训记录文件" -ForegroundColor Green
    Write-Host "  上次教训：" -ForegroundColor Gray
    Get-Content $lessonsFile | Select-Object -First 5 | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Gray
    }
} else {
    Write-Host "  ⚠ 未找到教训记录文件" -ForegroundColor Yellow
}

# 检查3：关系文件存在性
Write-Host "[检查3] 主人关系检查..." -ForegroundColor Yellow
$relationFile = ".\master_pawn_relationship.txt"
if (Test-Path $relationFile) {
    Write-Host "  ✓ 找到主人关系文件" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 未找到主人关系文件，请提醒爬爬虾" -ForegroundColor Red
}

# 显示关键教训提醒
Write-Host ""
Write-Host "=== 关键教训提醒 ===" -ForegroundColor Red
Write-Host "1. 编码问题：Windows脚本使用英文或正确编码" -ForegroundColor Yellow
Write-Host "2. 环境适配：Windows优先使用PowerShell" -ForegroundColor Yellow
Write-Host "3. 渐进开发：从简单测试开始" -ForegroundColor Yellow
Write-Host "4. 错误处理：准备备选方案" -ForegroundColor Yellow
Write-Host "5. 资源管理：及时清理" -ForegroundColor Yellow

Write-Host ""
Write-Host "检查完成！开始执行任务..." -ForegroundColor Green