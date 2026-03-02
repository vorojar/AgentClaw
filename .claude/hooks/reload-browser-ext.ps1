# Auto-reload Chrome extension when files in skills/browser/extension/ are modified.
# Called by Claude Code PostToolUse hook for Edit|Write.

$jsonInput = [Console]::In.ReadToEnd()
if (-not $jsonInput) { exit 0 }

$data = $jsonInput | ConvertFrom-Json
$filePath = $data.tool_input.file_path
if (-not $filePath) { exit 0 }

# Only trigger for browser extension files
if ($filePath -notmatch 'skills[\\/]browser[\\/]extension') { exit 0 }

try {
    $body = '{"action":"reload","args":{}}'
    Invoke-RestMethod -Uri 'http://localhost:3100/api/browser/exec' `
        -Method POST -ContentType 'application/json' `
        -Body $body -TimeoutSec 3 | Out-Null
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Browser extension auto-reloaded."}}'
} catch {
    # Gateway not running or extension not connected — silently skip
    exit 0
}
