@echo off
REM ===================================================================
REM  run-ui.cmd - open the outreach window (sent / received mailboxes)
REM
REM  IMPORTANT: this file is ASCII-only on purpose.
REM  cmd.exe reads .cmd in the OEM code page (866 here), not UTF-8, so
REM  Cyrillic inside a .cmd turns into mojibake and cmd then tries to
REM  execute the broken fragments. Measured: a UTF-8-BOM .cmd with
REM  Russian comments failed with "'o' is not recognized...".
REM
REM  -STA is mandatory for WPF, so it is hardcoded here.
REM
REM  Data: sent-log.csv and inbox-replies.csv next to this file.
REM  The window refreshes itself every minute; F5 refreshes now.
REM  Double-click a row to copy it to the clipboard.
REM ===================================================================
setlocal
cd /d "%~dp0"
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0ui-app.ps1" %*
if errorlevel 3 (
  echo.
  echo Could not open the window. Usually means there is no interactive desktop session.
  echo Launch it by double-click from Explorer, not as a service.
)
