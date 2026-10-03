#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный сервер для проверки прототипа.
Отличие от `python -m http.server`: отдаёт заголовки no-store, чтобы браузер
не держал старые версии файлов и проверка всегда показывала актуальное состояние.

Запуск:  python serve.py [порт]     по умолчанию 8812
Адрес:   http://127.0.0.1:8812/
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0] or "."


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8812
    handler = partial(NoCacheHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Прототип: http://127.0.0.1:{port}/  (Ctrl+C — остановить)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nОстановлено")


if __name__ == "__main__":
    main()