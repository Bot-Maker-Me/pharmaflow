# Finds the folder where the PharmFlow agent (flow.py + its config.ini) really lives on this PC
# and writes a tiny batch file that sets AGENT and PYX. Read-only.
param([string]$Out)
$dir = ''; $py = ''
try {
  $a = (Get-ScheduledTask -TaskName 'PharmFlow Agent' -ErrorAction Stop).Actions[0]
  $exe = ([string]$a.Execute).Trim('"'); $taskArgs = [string]$a.Arguments; $wd = ([string]$a.WorkingDirectory).Trim('"')
  $flow = ($taskArgs -replace '"', '').Split(' ') | Where-Object { $_ -like '*flow.py' } | Select-Object -First 1
  if ($flow -and [System.IO.Path]::IsPathRooted($flow)) { $dir = Split-Path $flow }
  elseif ($wd) { $dir = $wd }
  if ($exe -match 'python') { $py = $exe }
} catch { }
if (-not $dir -or -not (Test-Path (Join-Path $dir 'flow.py'))) {
  $hit = Get-ChildItem 'C:\' -Filter flow.py -Recurse -Depth 4 -ErrorAction SilentlyContinue |
         Where-Object { Test-Path (Join-Path $_.DirectoryName 'config.ini') -PathType Leaf } |
         Where-Object { (Get-Content (Join-Path $_.DirectoryName 'config.ini') -Raw) -match '(?im)^\s*\[Database\]' } |
         Select-Object -First 1
  if ($hit) { $dir = $hit.DirectoryName }
}
if (-not $py -and $dir) { $v = Join-Path $dir '.venv\Scripts\python.exe'; if (Test-Path $v) { $py = $v } }
if (-not $py) { $py = 'python' }
$lines = @()
if ($dir) { $lines += ('set "AGENT=' + $dir + '"') }
$lines += ('set "PYX=' + $py + '"')
Set-Content -Path $Out -Value $lines -Encoding ASCII
