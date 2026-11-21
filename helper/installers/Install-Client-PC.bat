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
copy /Y "%~dp0workstation_helper.py" "%DEST%\workstation_helper.py" >nul
if errorlevel 1 (
  echo  Could not find workstation_helper.py next to this file. Keep both files in the same folder.
  pause
  exit /b
)

cd /d "%DEST%"
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
echo  Installing parts (needs internet)...
".venv\Scripts\python.exe" -m pip install -q Flask waitress pyautogui pyperclip pystray Pillow
if errorlevel 1 (
  echo  Install failed. Check the internet and try again.
  pause
  exit /b
)

if exist "%DEST%\config.ini" goto havecfg
echo.
set "TOKEN="
set /p "TOKEN=  Type the Helper password (same one you put in PharmFlow Settings): "
echo.
echo  Now open Kroll and click on it. In 5 seconds I will read its window name.
echo.
".venv\Scripts\python.exe" workstation_helper.py --show-window > "%TEMP%\pf_title.txt" 2>&1
type "%TEMP%\pf_title.txt"
echo.
set "TITLE="
set /p "TITLE=  Type the window name you see above (a word that is always in it, e.g. Start Screen): "
(
echo [Helper]
echo TOKEN = %TOKEN%
echo WINDOW_KROLL = %TITLE%
echo WAIT_FOR_WINDOW_SEC = 10
) > "%DEST%\config.ini"
:havecfg

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
