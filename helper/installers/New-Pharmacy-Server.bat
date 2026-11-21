@echo off
setlocal
title PharmFlow - set up a new pharmacy (Kroll server)
net session >nul 2>nul
if errorlevel 1 (
  echo  Asking for Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "DEST=C:\PharmFlow\helper"
echo.
echo  PharmFlow - set up a new pharmacy (Kroll server)
echo  -------------------------------------------------
echo  Have ready: Kroll SQL user + password, and this pharmacy's PharmFlow key.
echo.

rem ---- find a REAL Python (the Windows Store shortcut does not count) ----
set "PY="
call :trypy "py -3"
if not defined PY call :trypy "python"
if not defined PY call :knownpy
if not defined PY (
  echo  Python is not installed. Installing it now, please wait...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  call :knownpy
)
if not defined PY (
  echo.
  echo  Could not install Python automatically.
  echo  Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^),
  echo  then double-click this file again.
  pause
  exit /b
)
goto havepy
:trypy
%~1 -c "import sys" >nul 2>nul
if not errorlevel 1 set "PY=%~1"
exit /b
:knownpy
for %%P in ("%LocalAppData%\Programs\Python\Python312\python.exe" "%ProgramFiles%\Python312\python.exe" "%LocalAppData%\Programs\Python\Python313\python.exe" "%ProgramFiles%\Python313\python.exe") do (
  if exist %%P if not defined PY set PY="%%~P"
)
exit /b
:havepy

if not exist "%DEST%" mkdir "%DEST%"
for %%F in (flow.py setup_server.py config.ini.example requirements.txt install_service.ps1) do (
  if not exist "%~dp0%%F" (
    echo  Missing file next to this one: %%F
    pause
    exit /b
  )
  copy /Y "%~dp0%%F" "%DEST%\%%F" >nul
)

cd /d "%DEST%"
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
echo  Installing parts (needs internet)...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo  Install failed. Check the internet and try again.
  pause
  exit /b
)

".venv\Scripts\python.exe" setup_server.py
if errorlevel 1 (
  pause
  exit /b
)

echo.
echo  Testing the connection to Kroll and PharmFlow...
".venv\Scripts\python.exe" flow.py --test
if errorlevel 1 (
  echo.
  echo  The test failed - read the message above. Usually a wrong SQL user/password or key.
  echo  Run this file again to re-enter them.
  del /q config.ini >nul 2>nul
  pause
  exit /b
)

echo.
echo  Starting PharmFlow in the background...
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\install_service.ps1"
echo.
echo  DONE. It starts by itself whenever this server is turned on.
echo  It begins in SHADOW mode: it only reads and never types into Kroll.
echo.
pause
