@echo off
title PharmFlow - look for patient notes in Kroll (read only)
cd /d C:\PharmFlow\helper
copy /Y "%~dp0probe_patient_notes.py" "C:\PharmFlow\helper\probe_patient_notes.py" >nul
".venv\Scripts\python.exe" probe_patient_notes.py > patient_notes_probe.txt 2>&1
echo.
echo  Done. This only read table and column NAMES, no patient data.
echo  The result opens now - copy all of it and send it back.
start notepad patient_notes_probe.txt
pause
