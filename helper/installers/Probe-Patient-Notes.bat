@echo off
title PharmFlow - look for patient notes in Kroll (read only)
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
copy /Y "%~dp0probe_patient_notes.py" "%AGENT%\probe_patient_notes.py" >nul
"%PYX%" probe_patient_notes.py > patient_notes_probe.txt 2>&1
echo.
echo  Done. This only read table and column NAMES, no patient data.
echo  The result opens now - copy all of it and send it back.
start notepad "%AGENT%\patient_notes_probe.txt"
pause
