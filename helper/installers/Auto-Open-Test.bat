@echo off
title PharmFlow - test: open the newest pending fax in Kroll (stops at the Rx Dropoff Form)
cd /d C:\PharmFlow\helper
copy /Y "%~dp0..\kroll_driver.py" "C:\PharmFlow\helper\kroll_driver.py" >nul
echo  Installing a small tool (needs internet)...
".venv\Scripts\python.exe" -m pip install -q pywinauto psutil
echo.
echo  Before you press a key: open Kroll, click the Inbound Docs tile, Show: Pending.
echo  This test selects the TOP fax, presses F2, picks "Use to process prescription(s)" and Process.
echo  It stops when the Rx Dropoff Form is open. It types nothing and saves nothing.
echo  Do not touch the mouse or keyboard while it runs.
pause
".venv\Scripts\python.exe" kroll_driver.py --test-first > auto_open_test.txt 2>&1
type auto_open_test.txt
start notepad auto_open_test.txt
echo.
echo  Close the Rx Dropoff Form in Kroll yourself. Send me the Notepad text.
pause
