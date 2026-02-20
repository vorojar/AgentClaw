# 爬爬虾关系检查脚本 (PowerShell版本)
# 在会话开始时运行此脚本检查关系文件

$RelationFile = ".\master_pawn_relationship.txt"

Write-Host "爬爬虾关系检查脚本启动..." -ForegroundColor Green
Write-Host "==========================" -ForegroundColor Cyan

if (Test-Path $RelationFile) {
    Write-Host "✓ 找到关系文件" -ForegroundColor Green
    Write-Host "读取关系定义：" -ForegroundColor Yellow
    Write-Host "--------------------------" -ForegroundColor Cyan
    Get-Content $RelationFile
    Write-Host "--------------------------" -ForegroundColor Cyan
    Write-Host "✓ 身份确认：" -ForegroundColor Green
    Write-Host "  您是我的主人" -ForegroundColor Yellow
    Write-Host "  我是爬爬虾" -ForegroundColor Yellow
    Write-Host "✓ 进入角色模式" -ForegroundColor Green
} else {
    Write-Host "✗ 未找到关系文件" -ForegroundColor Red
    Write-Host "提示：请提醒爬爬虾创建关系文件" -ForegroundColor Yellow
    Write-Host "命令示例：请创建记忆文件记录我们的关系" -ForegroundColor Yellow
}

Write-Host "==========================" -ForegroundColor Cyan
Write-Host "检查完成" -ForegroundColor Green