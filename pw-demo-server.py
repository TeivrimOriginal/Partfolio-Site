"""Демо-сервер страницы расшифровки для ручной проверки passkey в браузере.

Запуск: python pw-demo-server.py   (порт можно сменить через PW_DEMO_PORT)
Страница: http://localhost:8099/d/demo-token-1
Кодовое слово: demo-codeword-1

Поднимает только сайт из secret-bot/crypt_bot.py (без Telegram): файл
отдаётся из памяти, чтобы не нужен токен бота.
"""

import asyncio
import os
import sys

# Порт берём свободный: 127.0.0.1:8080 на этой машине занят Steam (CEF),
# а origin должен совпадать с BASE_URL — поэтому настраиваем до импорта бота.
PORT = int(os.environ.get("PW_DEMO_PORT", "8099"))
os.environ.setdefault("BASE_URL", f"http://localhost:{PORT}")
os.environ.setdefault("DB_PATH", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "pw-demo.db"))

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-bot"))

from aiohttp import web

import crypt_bot as cb

TOKEN = "demo-token-1"
PASSWORD = "demo-codeword-1"
PAYLOAD = "Демо-файл для проверки passkey.\n".encode("utf-8") * 100


class LocalBot:
    """Заглушка: вместо скачивания из Telegram отдаёт заранее зашифрованный байты."""

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
            (TOKEN, "local-file", "демо-отчёт.txt", __import__("time").time()),
        )
        cb._db.commit()
    app = cb.build_web_app(LocalBot())
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"Демо: http://localhost:{PORT}/d/{TOKEN}  кодовое слово: {PASSWORD}",
          flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
