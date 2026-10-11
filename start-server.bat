@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again. & pause & exit /b)
if not exist node_modules call npm install
start "" http://localhost:3000/admin
node server.js
pause
