@echo off
title PharmFlow - can the computer see Kroll's buttons? (read only)
cd /d C:\PharmFlow\helper
copy /Y "%~dp0..\probe_kroll_ui.py" "C:\PharmFlow\helper\probe_kroll_ui.py" >nul
echo  Installing a small tool (needs internet)...
".venv\Scripts\python.exe" -m pip install -q pywinauto psutil
echo.
echo  Follow the three prompts. Nothing is clicked or typed. No patient text is saved.
".venv\Scripts\python.exe" probe_kroll_ui.py
start notepad kroll_ui_probe.txt
echo.
echo  Copy everything from the Notepad window and send it back.
pause
