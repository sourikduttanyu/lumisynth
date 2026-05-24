@echo off
setlocal

title LumiSynth
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo LumiSynth needs Node.js before it can run.
  echo Install the LTS version from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo npm was not found. Reinstall Node.js LTS from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo First launch: installing LumiSynth dependencies...
  echo This can take a minute.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Check your internet connection, then run this file again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting LumiSynth...
echo Keep this window open while using it.
echo.
start "" "http://localhost:5173"
call npm run dev -- --host 127.0.0.1

echo.
echo LumiSynth stopped.
pause
