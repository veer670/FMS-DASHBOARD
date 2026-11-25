# Work Execution & Dashboard — Homeland FMS

Two pages (tabs in the header) showing work execution status from the Homeland Group **FMS (ASAP)** database, read through its read-only PostgREST API.

Runs on your PC at **http://localhost:4783**, or online on **Vercel** (see *Put it online* below).

## Sign in and users
Every page needs a user ID and password.

- **First run:** open http://localhost:4783. With no accounts yet, the sign-in page asks you to create the **admin account**.
- **Admins** see a **Users** page in the menu: the **Add user** button opens the form to create a user ID and password; the table lets you reset a password, make someone admin or user, disable or delete an account. Disabling, deleting or resetting a password signs that person out straight away. You cannot remove your own admin access, and there is always at least one admin.
- **Everyone** can *Sign out* from the sidebar. Passwords are set and reset by an admin on the Users page.
- On your PC, accounts are stored in `data/users.json` (git-ignored). Online, they are stored in an Upstash Redis database connected to the Vercel project. Passwords are stored only as salted scrypt hashes. Sign-ins last 12 hours (`SESSION_HOURS`). 8 wrong passwords from one IP lock sign-in for 10 minutes.
- Online, creating the first admin also needs the **setup code** (`SETUP_CODE` in Vercel), so nobody else who finds the link can become admin.
- The server listens on this computer only (`HOST=127.0.0.1`). To let colleagues on the office network open it, set `HOST=0.0.0.0` in `.env` and share `http://<this-computer's-IP>:4783`.

## Pages
- **Work Execution** (`/`): cards + task table with export.
- Menu order: **Dashboard**, **Analytics**, **Work Execution**, and **Users** (admins only). After signing in you land on the Dashboard.
- **Dashboard** (`/dashboard.html`): no filter bar. Progress by project (click one to see its locations, click a location to focus on it), progress by department, progress by area (click an area to see its sub areas) and overdue ageing. *Back to …* and *All projects* links step back out. It also opens on whatever selection you bring from Work Execution.
- **Analytics** (`/analytics.html`): pick a project, then a location, then an area from rows of tiles (each shows % done, tasks and how many are late). Six count cards follow the selection: Total, Completed, Pending, Overdue, On hold and Done last 7 days, each with *View all* opening those tasks in Work Execution. A table below gives the same counts for each location, area or sub area in the selection.

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

## Put it online (Vercel)
The repo is ready for Vercel (`vercel.json` + `api/index.js`); every address goes through one function that checks the sign-in first.

1. Push to GitHub (`git push -u origin main`). Vercel redeploys on each push.
2. Vercel > the project > **Settings > Environment Variables**, add for *Production* and *Preview*:
   - `FMS_API_TOKEN` = the read-only ASAP token (same as in `.env`)
   - `SETUP_CODE` = any private word you choose (only needed to create the first admin)
3. Vercel > the project > **Storage** > **Create Database** > **Upstash for Redis** (free plan) > connect it to this project. Keep the default variable prefix; it adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Deployments** > the latest one > **Redeploy** (new settings only apply after a redeploy).
5. Open the site: create the admin with the setup code, then add users on the Users page.

Accounts made on your PC are not copied online; create them again on the online Users page. If the data does not load, `Logs` in Vercel shows the reason (for example the ASAP server refusing Vercel's IP).

## Look and feel
**Onyx & Gold** theme, matched to the Homeland logo gold (#B38750): charcoal sidebar with the Homeland logo, gold accents and progress bars, charcoal table header, status tags, IBM Plex Sans. The sign-in page uses the same charcoal and gold. All colours live in `public/theme.css`. Works down to phone width.

**WhatsApp** button (Work Execution and Dashboard) opens WhatsApp with a summary of the current selection, ready to send.

(`public/hero.jpg`, `hero.svg`, `side-skyline.svg`, `logo-light.png` and `theme.js` are from earlier designs and are not used.)

## How it works
`lib/app.js` (zero-dependency Node) does the work: `server.js` runs it on your PC, `api/index.js` runs it on Vercel. It serves `public/index.html` and `GET /api/data`, which pulls Project, Tower, Area, SubArea, Task, Department, Update and Chatmessage from PostgREST (cached 60 s; the page auto-refreshes every 5 minutes). The token stays in `.env` (or Vercel's Environment Variables) and is never sent to the browser.
