# Work Execution — Homeland FMS

One-page dashboard of work execution status from the Homeland Group **FMS (ASAP)** database, read through its read-only PostgREST API.

Runs locally at **http://localhost:4783**

## Filters
**Project → Tower → Area → Sub Area** (ASAP's own levels), cascading. Picking a lower level fills in the levels above it; changing a level clears the ones below. Inactive items are excluded.

## Cards
| Card | Meaning |
|---|---|
| Total Tasks | All active tasks in the current selection |
| Completed | Tasks marked completed |
| Pending | Tasks not yet completed |
| Overdue | Pending tasks whose end date is before today |
| Completed This Week | Tasks completed since Monday 00:00 |

Click a card to show just those tasks in the table (click again to clear).

## Tasks table
Columns: **Area · Sub Area · Task · Status · End Date · Remarks** — every task in the current filter selection, in ASAP order.

- **Status**: ✓ Completed / Pending / ⚠ Overdue (with days late).
- **Remarks**: the latest step-chat message the site team typed in ASAP (with who and which step). Tasks without chat show the latest ASAP activity-log entry in grey italics; automatic overdue reminders are hidden.
- Status chips (All / Pending / Overdue / Completed / This week), search box, click a column header to sort (third click returns to ASAP order).

## Run it (Windows PowerShell)
Requires **Node.js 18+**. No `npm install` needed.

```powershell
cd "$env:USERPROFILE\Desktop\FMS DASHBOARD"
node server.js --open
```
Keep the window open while using the page. First time only: create `.env` from `.env.example` with the API token (or double-click `start.bat`, which asks for it).

## How it works
`server.js` (zero-dependency Node) serves `public/index.html` and `GET /api/data`, which pulls Project, Tower, Area, SubArea, Task, Department, Update and Chatmessage from PostgREST (cached 60 s; the page auto-refreshes every 5 minutes). The token stays in `.env` on this machine and is never sent to the browser.
