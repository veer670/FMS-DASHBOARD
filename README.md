# Work Execution — Homeland FMS

One-page dashboard showing work execution status from the Homeland Group **FMS (ASAP)** database, read through its read-only PostgREST API.

Runs locally at **http://localhost:4783**

## Cards
| Card | Meaning |
|---|---|
| Total Tasks | All active tasks in the current selection |
| Completed | Tasks marked completed |
| Pending | Tasks not yet completed |
| Overdue | Pending tasks whose due date is before today |
| Completed This Week | Tasks completed since Monday 00:00 |

## Filters
**Location → Tower → Area → Sub Area**, cascading. Picking a lower level fills in the levels above it; changing a level clears the ones below. *Location* is the FMS project (e.g. Homeland Regalia, Homeland Global Park, CP-67). Inactive items are excluded.

## Run it (Windows PowerShell)
Requires **Node.js 18+**. No `npm install` needed.

```powershell
cd "$env:USERPROFILE\Desktop\FMS DASHBOARD"
node server.js --open
```
Keep the window open while using the page. First time only: create `.env` from `.env.example` with the API token (or double-click `start.bat`, which asks for it).

## How it works
`server.js` (zero-dependency Node) serves `public/index.html` and `GET /api/data`, which pulls Project, Tower, Area, SubArea and Task from PostgREST (cached 60 s; the page auto-refreshes every 5 minutes). The token stays in `.env` on this machine and is never sent to the browser.
