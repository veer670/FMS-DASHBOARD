# Work Execution & Dashboard — Homeland FMS

Two pages (tabs in the header) showing work execution status from the Homeland Group **FMS (ASAP)** database, read through its read-only PostgREST API.

Runs locally at **http://localhost:4783**

## Pages
- **Work Execution** (`/`): cards + task table with export.
- **Dashboard** (`/dashboard.html`): the same filters, plus status split, progress by the next level down (Project → Location → Area → Sub Area; click a bar to drill in), progress by department, tasks completed per week (12 weeks) and overdue ageing (1–7 / 8–30 / 31–60 / 61–90 / 90+ days late).

The filters travel with you when you switch tabs.

## Filters
**Project → Location → Area → Sub Area**, cascading. *Location* is ASAP's "Tower" level (e.g. Basements, Flat Work, Lobbies Work). Picking a lower level fills in the levels above it; changing a level clears the ones below. Inactive items are excluded.

## Cards
| Card | Meaning |
|---|---|
| Total Tasks | All active tasks in the current selection |
| Completed | Tasks marked completed |
| Pending | Tasks not yet completed |
| Overdue | Pending tasks whose end date is before today |
| Hold | Tasks marked inactive in ASAP — the task itself, or its sub area / area / location. Not counted in Total, Pending or Overdue |
| Completed This Week | Tasks completed since Monday 00:00 |

Click a card to show just those tasks in the table (click again to clear).

## Tasks table
Columns: **Area · Sub Area · Task · Status · End Date · Remarks** — every task in the current filter selection, in ASAP order.

- **Status**: ✓ Completed / Pending / ⚠ Overdue (with days late) / Hold.
- **Remarks**: the latest step-chat message the site team typed in ASAP (with who and which step). Tasks without chat show the latest ASAP activity-log entry in grey italics; automatic overdue reminders are hidden.
- Status chips (All / Pending / Overdue / Completed / Hold / This week), search box, click a column header to sort (third click returns to ASAP order).

## Export
**⤓ Export Excel** downloads exactly the tasks currently shown in the table (filters, status chip and search applied) as a formatted `.xlsx`: title and selection line, navy header row with filters, frozen header, coloured status, real Excel dates, A4 landscape print setup with page numbers. Columns: S.No, Project, Location, Area, Sub Area, Task, Department, Status, Start Date, End Date, Days Late, Completed On, Remarks, Remark By, Remark Date.

## Run it (Windows PowerShell)
Requires **Node.js 18+**. No `npm install` needed.

```powershell
cd "$env:USERPROFILE\Desktop\FMS DASHBOARD"
node server.js --open
```
Keep the window open while using the page. First time only: create `.env` from `.env.example` with the API token (or double-click `start.bat`, which asks for it).

## Look and feel
Corporate theme shared in `public/theme.css` and `public/theme.js`: sidebar with the page menu, a colour-tinted status ledger with icons, coloured table header, status tags, accent-marked panel titles, IBM Plex Sans. Works down to phone width.

**Colour themes** (pick in the sidebar, remembered per browser):
- **Blueprint** (default): the page as a construction drawing sheet: grid paper, blueprint sidebar, a drawing title block in the header (Project, Location, Updated, Sheet), crop-mark panel corners, Barlow Condensed numerals, stamped status tags, dimension-line progress bars.
- Homeland Navy (navy + brass), Deep Teal (teal + amber), Charcoal (charcoal + copper).

## How it works
`server.js` (zero-dependency Node) serves `public/index.html` and `GET /api/data`, which pulls Project, Tower, Area, SubArea, Task, Department, Update and Chatmessage from PostgREST (cached 60 s; the page auto-refreshes every 5 minutes). The token stays in `.env` on this machine and is never sent to the browser.
