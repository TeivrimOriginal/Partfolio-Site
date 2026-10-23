@echo off
REM ===================================================================
REM  run-offer.cmd - собрать рассылку с предложением 500/1000/2000 и вложением
REM
REM  Цепочка:
REM    1. пример сайта для каждой компании (персональный, с баннером "это пример")
REM    2. .eml с письмом + вложение, тема закодирована по RFC 2047
REM    3. проверка: вложение после декодирования совпадает с исходником
REM
REM  ОТПРАВКА РУЧНАЯ. Открой outbox\dNNN.eml в почтовом клиенте и нажми отправить.
REM  Не отправляй всё разом: 2-3 письма в день, по одному получателю.
REM ===================================================================
setlocal
cd /d "%~dp0"
echo.
echo === 1/4 примеры: сайт + админ-панель (персональные) ===
powershell -NoProfile -ExecutionPolicy Bypass -File make-sample.ps1 -All
echo.
echo === 2/4 письма .eml с двумя вложениями ===
powershell -NoProfile -ExecutionPolicy Bypass -File make-eml.ps1 -All
echo.
echo === 3/4 проверка писем и вложений ===
powershell -NoProfile -ExecutionPolicy Bypass -File test-eml.ps1
echo.
echo === 4/4 последний рубеж перед отправкой ===
powershell -NoProfile -ExecutionPolicy Bypass -File preflight.ps1
echo.
echo --- что дальше ---
echo   outbox\dNNN.eml        открыть и отправить
echo   outbox\sample\         примеры сайта и админки глазами клиента
echo   outbox\eml-index.csv   кому что отправлено
echo.
echo Если preflight написал "ГОТОВО К ОТПРАВКЕ: 6 из 6" и "блокеров: 0" —
echo можно отправлять. Если есть блокеры - сначала исправь, письмо уйдёт кривым.
echo.
pause
