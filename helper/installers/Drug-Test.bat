@echo off
title PharmFlow - look up one drug in Kroll (read only)
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
set "DRUG="
set /p "DRUG=  Type a drug and strength to look up (for example: candesartan 4 mg): "
"%PYX%" flow.py --drug-test %DRUG% > drug_test.txt 2>&1
echo.
echo  Done. Only drug names from Kroll's drug list are shown, no patient information.
start notepad "%AGENT%\drug_test.txt"
pause
