"""Локальный отдающий сервер для автоматизации Gmail.

Зачем. Чтобы вставить текст письма в окно Gmail, страница должна получить
байты из файла на диске. Раньше для этого текст вручную резался на куски
base64 по 1400 символов и вклеивался в вызовы evaluate — я один раз вклеил
кусок длиной 1817 вместо 1400, и письмо ушло бы с битым текстом. Такая
ошибка невидима: сумма длин не проверяется глазами.

Теперь страница делает fetch() и получает ровно те байты, что лежат в файле.
Нарезки больше нет — ошибка исключена конструктивно.

CORS: страница живёт на https://mail.google.com и тянет http://127.0.0.1,
поэтому без Access-Control-Allow-Origin браузер отвечает «Failed to fetch».
Chrome считает 127.0.0.1 потенциально доверенным источником, поэтому смешанного
содержимого (https -> http) здесь нет — только CORS.

Run:
    python serve-letters.py 8765
"""
import http.server
import os
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # доступ с любой вкладки: письма читает страница Gmail
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        # только наш случай: отдача файла письма
        sys.stderr.write("[letters] %s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("serving %s on http://127.0.0.1:%d" % (ROOT, port), flush=True)
    srv.serve_forever()