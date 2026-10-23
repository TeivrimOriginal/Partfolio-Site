@echo off
REM ===================================================================
REM  run-daily.cmd - ежедневная рутина продаж (40-60 минут)
REM
REM  1. что просрочено / назначено на сегодня
REM  2. подготовить письма именно по этим сделкам (шаблон выбирает этап)
REM  3. воронка и деньги
REM
REM  Письма НЕ отправляются автоматически. Файлы падают в outbox\ -
REM  отправляешь руками, по одному получателю, без копий и вложений.
REM ===================================================================
setlocal
cd /d "%~dp0"
echo.
echo === 1/3 что делать сегодня ===
powershell -NoProfile -ExecutionPolicy Bypass -File pipeline.ps1 due
echo.
echo === 2/3 подготовка писем ===
powershell -NoProfile -ExecutionPolicy Bypass -File send-wave.ps1 -Limit 7
echo.
echo === 3/3 воронка и деньги ===
powershell -NoProfile -ExecutionPolicy Bypass -File pipeline.ps1 stats
echo.
echo Отправь то, что в outbox\ (сегодняшние файлы в outbox\wave.csv).
echo Ответили -> pipeline.ps1 stage -Id dNNN -To b1
echo Договорились -> pipeline.ps1 stage -Id dNNN -To b4 -Value 35000 -Prepay 17500
echo Собрано     -> pipeline.ps1 stage -Id dNNN -To b7 -Paid 35000
echo.
pause
