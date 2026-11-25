@echo off
title PharmFlow - check recent faxes against Kroll (read only)
set "AGENT="
set "PYX="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0find-agent.ps1" -Out "%TEMP%\pf_agent.bat"
call "%TEMP%\pf_agent.bat"
if not defined AGENT (
  echo  Could not find where the PharmFlow agent is installed on this PC.
  echo  Run this on the Kroll server, the PC that has the PharmFlow Agent task.
  pause
  exit /b
)
echo  PharmFlow agent folder: %AGENT%
cd /d "%AGENT%"
echo  Checking the newest 15 prescription faxes against Kroll...
"%PYX%" flow.py --match-test 15 > match_test.txt 2>&1
echo.
echo  Done. The result shows only yes/no and counts, no patient names.
echo  It opens now - copy all of it and send it back.
start notepad "%AGENT%\match_test.txt"
pause
