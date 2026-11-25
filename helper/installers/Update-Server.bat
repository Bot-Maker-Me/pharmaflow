@echo off
setlocal
title PharmFlow - update Kroll server
net session >nul 2>nul
if errorlevel 1 (
  echo  Asking for Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo.
echo  PharmFlow - update Kroll server
echo  --------------------------------
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
set "SRC=%~dp0flow.py"
if not exist "%SRC%" set "SRC=%~dp0..\flow.py"
if not exist "%SRC%" (
  echo  flow.py was not found in the installers folder or the folder above it.
  echo  Extract the whole zip first, then run this again.
  pause
  exit /b
)
copy /Y "%SRC%" "%AGENT%\flow.py" >nul
if errorlevel 1 (
  echo  Could not copy flow.py to %AGENT%
  pause
  exit /b
)
echo  New flow.py copied. Restarting the agent...
schtasks /end /tn "PharmFlow Agent" >nul 2>nul
taskkill /F /IM python.exe >nul 2>nul
timeout /t 3 /nobreak >nul
schtasks /run /tn "PharmFlow Agent"
echo.
echo  DONE. Faxes will start showing in PharmFlow Intake in about 1-2 minutes.
echo.
pause
