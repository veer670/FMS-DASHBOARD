# Work Execution & Dashboard — Homeland FMS

Two pages (tabs in the header) showing work execution status from the Homeland Group **FMS (ASAP)** database, read through its read-only PostgREST API.

Runs locally at **http://localhost:4783**

## Sign in and users
Every page needs a user ID and password.

- **First run:** open http://localhost:4783. With no accounts yet, the sign-in page asks you to create the **admin account**.
- **Admins** see a **Users** page in the menu: create user IDs and passwords, reset a password, make someone admin or user, disable or delete an account. Disabling, deleting or resetting a password signs that person out straight away. You cannot remove your own admin access, and there is always at least one admin.
- **Everyone** can change their own password from the sidebar (*Change password*) and *Sign out*.
- Accounts are stored in `data/users.json` on this computer (git-ignored). Passwords are stored only as salted scrypt hashes. Sign-ins last 12 hours (`SESSION_HOURS` in `.env`); restarting the server signs everyone out. 8 wrong passwords from one computer lock sign-in for 10 minutes.
- The server listens on this computer only (`HOST=127.0.0.1`). To let colleagues on the office network open it, set `HOST=0.0.0.0` in `.env` and share `http://<this-computer's-IP>:4783`.

## Pages
- **Work Execution** (`/`): cards + task table with export.
- Menu order: **Dashboard**, **Work Execution**, and **Users** (admins only). After signing in you land on the Dashboard.
- **Dashboard** (`/dashboard.html`): no filter bar. Progress by project (click one to see its locations, click a location to focus on it), progress by department, progress by area (click an area to see its sub areas) and overdue ageing. *Back to …* and *All projects* links step back out. It also opens on whatever selection you bring from Work Execution.

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
Royal blue and Homeland gold, Inter font, all in `public/theme.css`:
- Blue gradient sidebar with the Homeland logo (`logo-light.png`), gold highlight on the current page, user card at the bottom.
- Picture header behind the title and filters, and behind the sign-in page: **`public/hero.jpg`** (Homeland Global Park). To change it, replace that file with another wide photo (about 1920 x 700) and refresh. If the file is missing, a skyline illustration (`hero.svg`) is shown instead.
- Coloured status cards with icons, rounded status tabs, navy table header with a gold line, rounded status tags.
- **WhatsApp** button (Work Execution and Dashboard) opens WhatsApp with a summary of the current selection, ready to send.

## How it works
`server.js` (zero-dependency Node) serves `public/index.html` and `GET /api/data`, which pulls Project, Tower, Area, SubArea, Task, Department, Update and Chatmessage from PostgREST (cached 60 s; the page auto-refreshes every 5 minutes). The token stays in `.env` on this machine and is never sent to the browser.
