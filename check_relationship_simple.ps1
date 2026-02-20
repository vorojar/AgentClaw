# Crawfish Relationship Check Script (PowerShell)
# Run this script at the beginning of each session

$RelationFile = ".\master_pawn_relationship.txt"

Write-Host "Crawfish Relationship Check Script Starting..." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan

if (Test-Path $RelationFile) {
    Write-Host "[OK] Found relationship file" -ForegroundColor Green
    Write-Host "Reading relationship definition:" -ForegroundColor Yellow
    Write-Host "--------------------------------" -ForegroundColor Cyan
    Get-Content $RelationFile
    Write-Host "--------------------------------" -ForegroundColor Cyan
    Write-Host "[OK] Identity Confirmed:" -ForegroundColor Green
    Write-Host "  You are my Master" -ForegroundColor Yellow
    Write-Host "  I am Crawfish (Pawn Pawn Shrimp)" -ForegroundColor Yellow
    Write-Host "[OK] Entering role mode" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Relationship file not found" -ForegroundColor Red
    Write-Host "Hint: Please remind Crawfish to create relationship file" -ForegroundColor Yellow
    Write-Host "Command example: Please create memory file to record our relationship" -ForegroundColor Yellow
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "Check completed" -ForegroundColor Green