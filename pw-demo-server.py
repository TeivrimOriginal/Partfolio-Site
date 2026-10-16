"""Демо-сервер страницы расшифровки для ручной проверки passkey в браузере.

Запуск: python pw-demo-server.py   (порт меняется через PW_DEMO_PORT)
Страница: http://localhost:8099/d/demo-token-1
Кодовое слово: demo-codeword-1

Поднимает сайт из secret-bot/web_app.py (FastAPI, без Telegram): файл
отдаётся из памяти, поэтому токен бота не нужен. Тот же способ запуска,
что и в crypt_bot.main(): uvicorn работает в текущем event loop.
"""

import asyncio
import os
import sys
import time

# Порт берём свободный: 127.0.0.1:8080 на этой машине занят Steam (CEF),
# а origin должен совпадать с BASE_URL — поэтому настраиваем до импорта бота.
PORT = int(os.environ.get("PW_DEMO_PORT", "8099"))
os.environ.setdefault("BASE_URL", f"http://localhost:{PORT}")
os.environ.setdefault("DB_PATH", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "pw-demo.db"))

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-bot"))

import uvicorn

import crypt_bot as cb
from web_app import create_app

TOKEN = "demo-token-1"
PASSWORD = "demo-codeword-1"
PAYLOAD = "Демо-файл для проверки passkey.\n".encode("utf-8") * 100


class LocalBot:
    """Заглушка: вместо скачивания из Telegram отдаёт заранее зашифрованные байты."""

    async def download(self, file_id, destination=None, **kwargs):
        destination.write(ENCRYPTED)


ENCRYPTED = cb.encrypt_file(PAYLOAD, PASSWORD)


async def main() -> None:
    await asyncio.to_thread(cb._master_key)
    # ссылка может уже лежать с прошлого запуска — пересоздаём её
    with cb._db_lock:
        cb._db.execute("DELETE FROM links WHERE token = ?", (TOKEN,))
        cb._db.execute(
            "INSERT INTO links (token, file_id, file_name, created) VALUES (?, ?, ?, ?)",
            (TOKEN, "local-file", "демо-отчёт.txt", time.time()),
        )
        cb._db.commit()
    config = uvicorn.Config(
        create_app(LocalBot()), host="0.0.0.0", port=PORT, log_level="warning"
    )
    print(f"Демо: http://localhost:{PORT}/d/{TOKEN}  кодовое слово: {PASSWORD}",
          flush=True)
    await uvicorn.Server(config).serve()


if __name__ == "__main__":
    asyncio.run(main())
