@echo off
REM ──────────────────────────────────────────────────────────
REM  SafeClaw — Double-click to launch the dashboard
REM  No terminal knowledge required!
REM ──────────────────────────────────────────────────────────

cd /d "%~dp0"

echo.
echo   ┌─────────────────────────────────────┐
echo   │        SafeClaw v1.0.0-beta         │
echo   │     Safe-by-default AI agent gate   │
echo   └─────────────────────────────────────┘
echo.

REM ── Step 1: Check for Node.js ──────────────────────────────

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   [!] Node.js is not installed.
    echo.
    echo   SafeClaw needs Node.js v18+ to run.
    echo   Opening the Node.js download page for you...
    echo.
    start https://nodejs.org/en/download
    echo   After installing Node.js, double-click this file again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
REM node -v outputs "v20.11.0" — extract major version
for /f "tokens=2 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo   [!] Node.js is too old. SafeClaw needs v18+.
    echo   Opening the Node.js download page...
    start https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

echo   [OK] Node.js found

REM ── Step 2: Install dependencies (first run only) ─────────

if not exist "node_modules" (
    echo   [..] First run - installing dependencies...
    echo.
    call npm install --production
    echo.
    echo   [OK] Dependencies installed
) else (
    echo   [OK] Dependencies ready
)

REM ── Step 3: Check for config ──────────────────────────────

if not exist "%USERPROFILE%\.safeclaw\config.json" (
    echo.
    echo   First time? The setup wizard will open in your browser.
    echo   You'll need your Authensor token to get started.
)

REM ── Step 4: Launch the dashboard ──────────────────────────

echo.
echo   Starting SafeClaw dashboard...
echo   ─────────────────────────────────
echo   The dashboard will open in your browser automatically.
echo   To stop SafeClaw, close this window or press Ctrl+C.
echo.

node src\server.js

echo.
echo   SafeClaw has stopped.
pause
