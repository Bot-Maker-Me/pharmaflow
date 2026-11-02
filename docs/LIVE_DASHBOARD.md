# Live dashboard (app page /app/live)

Shows the agent's heartbeat, prescriptions flowing in (refreshes every 3s), AUTO vs EXCEPTION, the reasons, and
how closely the agent's planned entry matches what staff typed in Kroll.

Needs: Settings -> API access token (same value as APP_ACCESS_TOKEN or EXTRACT_ACCESS_TOKEN in Vercel).

## Start a clean shadow week
1. On the server PC stop the task: `schtasks /End /TN PharmFlowAgent` (use your task name).
2. Update flow.py, then run `python flow.py --skip-backlog` once (jumps past the old pending rows).
3. Start the task again.
4. In the app open Live and press **Start shadow week now**. Older rows become "backlog" and are ignored by the
   numbers and the nightly report.

## Fixing "everything is EXCEPTION"
Run `python flow.py --profile PendingNewRx` (also `PatPln`, `Rx`). It prints how many rows are non-empty per column
(no patient data). Put the right column names in [Schema] / [RxSchema] of config.ini.
Comparison with staff needs [RxSchema]; without it the "Compared" counter stays at 0.
