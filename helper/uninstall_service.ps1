# Run in an Administrator PowerShell. Stops and removes the PharmFlow background task.
$name = "PharmFlow Agent"
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed '$name'."
