# Wrapper to run the Vault File Drop import on a schedule via Windows Task
# Scheduler. Logs to scripts/import-inbox-log.txt.
#
# To install (once):
#   1. Open Task Scheduler → Create Basic Task
#   2. Name: "Best Family Vault — import inbox"
#   3. Trigger: Daily at e.g. 2:00 AM
#   4. Action: Start a program
#      Program: powershell.exe
#      Arguments:  -NoProfile -ExecutionPolicy Bypass -File "C:\Projects\bestfamilyvault\scripts\import-inbox-runner.ps1"
#      Start in:   C:\Projects\bestfamilyvault
#   5. Finish — done.
#
# Re-run on demand any time with:
#   npm run import:inbox

$ErrorActionPreference = 'Continue'
Set-Location "C:\Projects\bestfamilyvault"
$log = "C:\Projects\bestfamilyvault\scripts\import-inbox-log.txt"
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"=== Run @ $ts ===" | Out-File -FilePath $log -Append -Encoding utf8
npm run import:inbox 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"" | Out-File -FilePath $log -Append -Encoding utf8
