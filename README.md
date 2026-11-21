# Homeland FMS Dashboard

Live progress dashboard for the Homeland Group **FMS (ASAP)** — projects, towers, areas, departments and contractors — read straight from the FMS Postgres database through its read-only PostgREST API.

Runs locally at **http://localhost:4783** (its own port, so it doesn't clash with other local dashboards).

## Run it

Requires **Node.js 18+**. No `npm install` needed — zero dependencies.

1. Windows: double-click **`start.bat`**. On first run it asks for the read-only API token and saves it to `.env` (git-ignored).
   Other OS / manual: copy `.env.example` to `.env`, paste the token into `FMS_API_TOKEN`, then `npm start` (opens the browser) or `node server.js`.
2. The dashboard opens at http://localhost:4783

Change the port with `PORT=` in `.env`.

## What's on it

| Section | What it shows |
|---|---|
| KPI row | Total tasks, % completed, overdue, due in 7 days, completed this week, step completion |
| Progress by tower / department / contractor | % of tasks completed with overdue counts; click a bar to filter everything |
| Tasks completed per week | Last 16 weeks, from `Task.completedAt` |
| Overdue tasks | Not completed and due date before today, with days late, manager and step progress |
| Due in the next 14 days | Upcoming due dates |
| Recent activity | Latest task/step updates (automatic `cron@system` reminders hidden) |
| Area breakdown | Per-area totals, done, open, overdue, % complete, last completion |
| Contractor area deadlines | `ContractorAreaDeadline` with revisions and past-deadline flags |

Filters: project, tower, department, contractor, free-text search, include inactive items. **⤓ CSV** exports the filtered task list.

### Definitions
- **Overdue** — task not completed and its `endDate` (calendar day, local time) is before today.
- **Not started** — not completed and `startDate` is after today.
- **Contractor progress** — tasks in the areas linked to the contractor (`_AreaToContractor`) whose department matches the contractor's department.
- Inactive projects/towers/areas/sub-areas/tasks are hidden unless *Include inactive* is ticked.
- Timestamps are stored in UTC and shown in local (IST) time.

## How it works

```
browser ──► localhost:4783 (server.js) ──► https://asap.homelandgroup.org/api/db (PostgREST, read-only)
```

- `server.js` — zero-dependency Node server. Serves `public/`, exposes `GET /api/data` (cached 60 s; `?refresh=1` forces a fetch) and `GET /api/health`. The token stays server-side in `.env` and is never sent to the browser.
- `lib/build.js` — pulls 12 tables in parallel with explicit column lists and shapes them for the UI.
- `public/index.html` — the whole dashboard (HTML/CSS/JS, no CDN, works offline on the LAN). Auto-refreshes every 5 minutes; light/dark theme.

API errors are shown in the page and logged in the terminal with the exact request and response.
