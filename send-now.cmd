@echo off
REM ===================================================================
REM  send-now.cmd - открыть все готовые письма сразу (одно действие)
REM
REM  Что делает:
REM    1. build-send-manifest.ps1 - разбор адресов: ролевой / фримейл / личный
REM    2. preflight.ps1 - если есть блокеры, останавливается и НЕ открывает
REM       ничего (письмо с неподставленным {name} уйдёт кривым)
REM    3. открывает ВСЕ outbox\*.eml одновременно, по одному окну на письмо
REM    4. печатает, какое вложение приложить руками, если клиент не подхватил
REM
REM  Отправка всё равно за тобой: в каждом окне нажать "Отправить".
REM  Автоотправки нет - на машине нет ни SMTP-реквизитов, ни почтового клиента,
REM  ни залогиненного вебмейла. Проверено: порт 1025 слушает svchost -s EventLog,
REM  это журнал событий, а не релей.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo === 1/3 разбор адресов ===
powershell -NoProfile -ExecutionPolicy Bypass -File build-send-manifest.ps1

echo.
echo === 2/3 допуск к отправке ===
powershell -NoProfile -ExecutionPolicy Bypass -File preflight.ps1
if errorlevel 2 (
  echo.
  echo ЕСТЬ БЛОКЕРЫ - письма не открываю. Сначала исправь, потом запусти снова.
  pause
  exit /b 2
)

echo.
echo === 3/3 открываю все письма ===
set /a N=0
for %%F in (outbox\*.eml) do (
  start "" "%%F"
  set /a N+=1
  timeout /t 1 /nobreak >nul
)
echo Открыто окон: %N%

echo.
echo --- если вложение не подхватилось, приложи руками: ---
for %%F in (outbox\sample\*.html) do echo   %%F

echo.
echo В каждом окне нажми "Отправить". Порядок: 3 письма в день, по одному
echo получателю. Не отвечай на свои же письма.
echo После отправки первой партии: pipeline.ps1 stage -Id d001 -To a2
echo.
pause
