@echo off
title PharmFlow - count pending inbound faxes (read only)
cd /d C:\PharmFlow\helper
".venv\Scripts\python.exe" flow.py --pending-test > pending_test.txt 2>&1
echo  Done. Counts only, no patient names. Copy the Notepad text and send it back.
echo  Also tell me the Inbound Docs number and the Pending list count you see in Kroll right now.
start notepad pending_test.txt
pause
