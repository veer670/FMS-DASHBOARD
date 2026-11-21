@echo off
title Homeland FMS Dashboard
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist .env (
  echo First run: no .env file found.
  set /p FMS_TOKEN=Paste the FMS read-only API token and press Enter: 
  call :writeenv
)
node server.js --open
pause
exit /b

:writeenv
(
  echo FMS_API_URL=https://asap.homelandgroup.org/api/db
  echo FMS_API_TOKEN=%FMS_TOKEN%
  echo PORT=4783
  echo CACHE_SECONDS=60
) > .env
echo Saved .env
exit /b
