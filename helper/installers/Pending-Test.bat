@echo off
title PharmFlow - count pending inbound faxes (read only)
net session >nul 2>nul
if errorlevel 1 (
  echo  Asking for Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
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
"%PYX%" flow.py --pending-test > pending_test.txt 2>&1
echo.
echo  Done. Counts only, no patient names. Copy the Notepad text and send it back.
echo  Also tell me the Inbound Docs number and the Pending list count you see in Kroll right now.
start notepad "%AGENT%\pending_test.txt"
pause
