<#
 Installs flow.py as a background Windows task that:
   - starts at boot (no one has to log in), keeps running when terminals are closed
   - restarts itself within a minute if it crashes
   - runs hidden, as SYSTEM
 Run once, in an ADMINISTRATOR PowerShell, from this helper folder:
     powershell -ExecutionPolicy Bypass -File .\install_service.ps1
#>
$ErrorActionPreference = "Stop"
$dir  = $PSScriptRoot
$py   = Join-Path $dir ".venv\Scripts\python.exe"
$cfg  = Join-Path $dir "config.ini"
$name = "PharmFlow Agent"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this in an Administrator PowerShell."
}
if (-not (Test-Path $py))  { throw "Missing $py - create the venv and pip install -r requirements.txt first." }
if (-not (Test-Path $cfg)) { throw "Missing config.ini - copy config.ini.example and fill it in first." }

Write-Host "Testing the configuration before installing..."
Push-Location $dir
& $py flow.py --test
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "flow.py --test failed - fix config.ini first." }
Pop-Location

# Only SYSTEM and Administrators may read the database password.
icacls $cfg /inheritance:r /grant:r "SYSTEM:(F)" "BUILTIN\Administrators:(F)" | Out-Null

$action    = New-ScheduledTaskAction -Execute $py -Argument "flow.py" -WorkingDirectory $dir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -MultipleInstances IgnoreNew `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "PharmFlow Kroll poller (flow.py)" | Out-Null
Start-ScheduledTask -TaskName $name

# A server that sleeps cannot poll: never sleep on AC power.
powercfg /change standby-timeout-ac 0 | Out-Null

Start-Sleep -Seconds 5
Write-Host "`nInstalled and started. State:" (Get-ScheduledTask -TaskName $name).State
Write-Host "Logs : $dir\logs\pharmflow.log"
Write-Host "Stop : Stop-ScheduledTask -TaskName '$name'     Remove: .\uninstall_service.ps1"
