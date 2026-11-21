@echo off
setlocal
title PharmFlow - update Kroll server
net session >nul 2>nul
if errorlevel 1 (
  echo  Asking for Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "DEST=C:\PharmFlow\helper"
echo.
echo  PharmFlow - update Kroll server
echo  --------------------------------
if not exist "%~dp0flow.py" (
  echo  flow.py is not next to this file. Put the new flow.py in the same folder and run again.
  pause
  exit /b
)
copy /Y "%~dp0flow.py" "%DEST%\flow.py" >nul
if errorlevel 1 (
  echo  Could not copy flow.py to %DEST%
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
