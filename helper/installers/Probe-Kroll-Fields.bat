@echo off
title PharmFlow - fax list and dropoff form fields? (read only)
cd /d C:\PharmFlow\helper
copy /Y "%~dp0..\probe_kroll_fields.py" "C:\PharmFlow\helper\probe_kroll_fields.py" >nul
echo  Installing a small tool (needs internet)...
".venv\Scripts\python.exe" -m pip install -q pywinauto psutil
echo.
echo  Follow the two prompts. Nothing is clicked or typed. No patient text is saved.
".venv\Scripts\python.exe" probe_kroll_fields.py
start notepad kroll_fields_probe.txt
echo.
echo  Copy everything from the Notepad window and send it back.
pause
