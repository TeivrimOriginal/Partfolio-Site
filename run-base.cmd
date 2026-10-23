@echo off
REM ===================================================================
REM  run-base.cmd - собрать базу предприятий без сайта, одним кликом
REM
REM  Порядок: сбор (медленный, checko штрафует за bursts) -> фильтр ->
REM  проверка почты -> проверка доменов -> письма.
REM  Всё пишется в эту же папку, сбор возобновляемый: повторный запуск
REM  не качает то, что уже разобрано (noweb-cache.jsonl).
REM
REM  Можно запускать много раз и оставлять на ночь.
REM ===================================================================
setlocal
cd /d "%~dp0"
echo.
echo === 1/5 сбор данных (checko.ru, 1 поток, 3.5 с между запросами) ===
powershell -NoProfile -ExecutionPolicy Bypass -File build-noweb-base.ps1 -Pages 300 -ShardSpan 10 -Throttle 1 -DelayMs 3500
echo.
echo === 2/5 фильтр и скоринг ===
powershell -NoProfile -ExecutionPolicy Bypass -File filter-noweb.ps1
echo.
echo === 3/5 проверка почтовых доменов (DNS) ===
powershell -NoProfile -ExecutionPolicy Bypass -File verify-emails.ps1
echo.
echo === 4/5 проверка "а правда ли нет сайта" ===
powershell -NoProfile -ExecutionPolicy Bypass -File check-leads-domain.ps1
echo.
echo === 5/5 письма для отправки ===
powershell -NoProfile -ExecutionPolicy Bypass -File make-mailmerge.ps1 -Count 25
echo.
echo === 6/6 просмотр базы в браузере ===
powershell -NoProfile -ExecutionPolicy Bypass -File render-base.ps1
echo.
echo === готово. Что смотреть: ===
echo   base.html                 - база с поиском и сортировкой, открыть двойным кликом
echo   noweb-leads-verified.csv  - база с проверкой сайта (колонка verdict)
echo   noweb-emails-sendable.txt - адреса, прошедшие проверку DNS
echo   outbox\index.csv         - порядок отправки
echo   noweb-stats.txt          - статистика
echo.
pause
