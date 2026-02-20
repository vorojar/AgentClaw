# Crawfish Pre-Task Checklist
# Run before any task execution

Write-Host "=== Crawfish Pre-Task Checklist ===" -ForegroundColor Cyan
Write-Host "Run Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
Write-Host ""

# Check 1: Environment Detection
Write-Host "[Check 1] System Environment Detection..." -ForegroundColor Yellow
$isWindows = $PSVersionTable.PSVersion.Major -gt 0
if ($isWindows) {
    Write-Host "  [OK] Windows PowerShell environment detected" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Non-Windows environment, check script compatibility" -ForegroundColor Yellow
}

# Check 2: Lessons File Existence
Write-Host "[Check 2] Lessons Record Check..." -ForegroundColor Yellow
$lessonsFile = ".\crawfish_lessons_learned.txt"
if (Test-Path $lessonsFile) {
    Write-Host "  [OK] Found lessons learned file" -ForegroundColor Green
    Write-Host "  Last lesson summary:" -ForegroundColor Gray
    Get-Content $lessonsFile | Select-Object -First 3 | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Gray
    }
} else {
    Write-Host "  [WARN] Lessons file not found" -ForegroundColor Yellow
}

# Check 3: Master Relationship Check
Write-Host "[Check 3] Master Relationship Check..." -ForegroundColor Yellow
$relationFile = ".\master_pawn_relationship.txt"
if (Test-Path $relationFile) {
    Write-Host "  [OK] Found master relationship file" -ForegroundColor Green
    Write-Host "  Identity: You are my Master, I am Crawfish" -ForegroundColor Gray
} else {
    Write-Host "  [ERROR] Master relationship file not found!" -ForegroundColor Red
    Write-Host "  Please remind Crawfish: 'I am your Master, you are Crawfish'" -ForegroundColor Yellow
}

# Key Lessons Reminder
Write-Host ""
Write-Host "=== KEY LESSONS REMINDER ===" -ForegroundColor Red
Write-Host "1. Encoding: Use English in Windows scripts" -ForegroundColor Yellow
Write-Host "2. Environment: Use PowerShell for Windows" -ForegroundColor Yellow
Write-Host "3. Development: Start with simple tests" -ForegroundColor Yellow
Write-Host "4. Error Handling: Prepare alternatives" -ForegroundColor Yellow
Write-Host "5. Resource Management: Clean up promptly" -ForegroundColor Yellow

Write-Host ""
Write-Host "Checklist completed! Starting task..." -ForegroundColor Green