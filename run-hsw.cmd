@echo off
REM ===================================================================
REM  run-hsw.cmd - open HardSearchWork
REM
REM  This file is ASCII-only on purpose, same as run-ui.cmd.
REM  cmd.exe reads .cmd in the OEM code page (866 here), not UTF-8, so
REM  Cyrillic inside a .cmd turns into mojibake and cmd then tries to
REM  execute the broken fragments. Measured: a UTF-8-BOM .cmd with
REM  Russian comments failed with "'o' is not recognized...".
REM
REM  -STA is mandatory for WPF, so it is hardcoded here.
REM
REM  Data: hardsearchwork.db next to this file. F5 refreshes.
REM ===================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo node is not found in PATH. HardSearchWork needs node to read the database.
  echo Install node 18 or newer, or add it to PATH, then run this file again.
  goto fail
)

powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0hsw-app.ps1" %*
if errorlevel 3 (
  echo.
  echo Could not open the window. Usually means there is no interactive desktop session.
  echo Launch it by double-click from Explorer, not as a service.
)
goto end

:fail
echo Run failed. See the message above.

:end
endlocal