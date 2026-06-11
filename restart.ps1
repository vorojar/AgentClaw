param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

$agentFlow = "C:\Users\voroj\.agent-flow\commands\agent-flow.ps1"

if ($NoBuild) {
    Write-Warning "Agent Flow owns restart policy; -NoBuild is ignored. Use agent-flow directly for custom restart flows."
}

& $agentFlow restart
exit $LASTEXITCODE
