@echo off
REM ===================================================================
REM  hsw-web.cmd - open HardSearchWork in the browser.
REM
REM  This file is ASCII-only on purpose, same as run-hsw.cmd: cmd.exe
REM  reads .cmd in the OEM code page (866 here), not UTF-8, so Cyrillic
REM  comments turn into mojibake and cmd then tries to execute the
REM  broken fragments.
REM
REM  The browser opens three seconds after the server starts, so the
REM  page is never opened against a port nobody listens yet. This
REM  window keeps the server in the foreground: Ctrl+C stops it.
REM
REM  Data: hsw/hsw.sqlite. Port: 8787, or HSW_PORT if it is set.
REM ===================================================================
setlocal
cd /d "%~dp0"

if "%HSW_PORT%"=="" set HSW_PORT=8787

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo node is not found in PATH. HardSearchWork needs node to read the database.
  echo Install node 18 or newer, or add it to PATH, then run this file again.
  goto fail
)

start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:%HSW_PORT%/"
node hsw\ui.mjs
goto end

:fail
echo Run failed. See the message above.

:end
endlocal
