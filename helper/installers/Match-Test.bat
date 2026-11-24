@echo off
title PharmFlow - check recent faxes against Kroll (read only)
net session >nul 2>nul
cd /d C:\PharmFlow\helper
echo  Checking the newest 15 prescription faxes against Kroll...
".venv\Scripts\python.exe" flow.py --match-test 15 > match_test.txt 2>&1
echo.
echo  Done. The result shows only yes/no and counts, no patient names.
echo  It opens now - copy all of it and send it back.
start notepad match_test.txt
pause
