@echo off
setlocal
title PharmFlow - set up this PC
set "DEST=C:\PharmFlow\helper"
echo.
echo  PharmFlow - set up this PC (about 2 minutes)
echo  ---------------------------------------------
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
copy /Y "%~dp0..\workstation_helper.py" "%DEST%\workstation_helper.py" >nul
copy /Y "%~dp0..\kroll_driver.py" "%DEST%\kroll_driver.py" >nul
if errorlevel 1 (
  echo  Could not find workstation_helper.py in the folder above. Extract the whole zip first.
  pause
  exit /b
)

cd /d "%DEST%"
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
echo  Installing parts (needs internet)...
".venv\Scripts\python.exe" -m pip install -q Flask waitress pyautogui pyperclip pystray Pillow pywinauto psutil
if errorlevel 1 (
  echo  Install failed. Check the internet and try again.
  pause
  exit /b
)

if exist "%DEST%\config.ini" goto havecfg
echo.
set "TOKEN="
set /p "TOKEN=  Type the Helper password (same one you put in PharmFlow Settings): "
(
echo [Helper]
echo TOKEN = %TOKEN%
echo WAIT_FOR_WINDOW_SEC = 10
) > "%DEST%\config.ini"
:havecfg
rem old versions asked for a window name; now Kroll (Fill.exe) is found automatically
powershell -NoProfile -Command "$p='%DEST%\config.ini'; (Get-Content $p) | Where-Object { $_ -notmatch '^\s*WINDOW_KROLL' } | Set-Content $p"

rem start automatically when this PC logs in
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
echo @echo off
echo cd /d "%DEST%"
echo start "" /min ".venv\Scripts\pythonw.exe" workstation_helper.py
) > "%STARTUP%\PharmFlow Helper.bat"

taskkill /F /IM pythonw.exe >nul 2>nul
call "%STARTUP%\PharmFlow Helper.bat"

echo.
echo  DONE. The helper is running (small icon near the clock).
echo  It will start by itself every time this PC is turned on.
echo  In PharmFlow: Settings - Helper URL http://localhost:48120 - Helper password - same as above.
echo.
pause
