"""Проверка passkey-интеграции и кликабельных ссылок в secret-bot.

Запуск: python test-passkey.py

Что проверяется:
1. Разбор WebAuthn-ответов синтетическим аутентификатором (создание и вход),
   включая отказы: не тот origin, не тот challenge, битая подпись, нет UV.
2. Одноразовость challenge.
3. Полный проход по HTTP через FastAPI TestClient: страница -> неверное
   слово -> верное слово -> регистрация passkey -> вход по passkey ->
   скачивание файла по сессии.
4. Отказ без сессии и отказ по клону ключа (счётчик не вырос).
5. Ссылки в боте: в личке — через <a href>, в группе — обычный URL.
6. Сайт собирается на FastAPI (роуты web_app.create_app).
7. PWA для Android: манифест, service worker, иконки.
8. Статика пакета: никто не зовёт async-функцию без await.
"""

import hashlib
import json
import os
import sys
import tempfile

os.environ["DB_PATH"] = tempfile.mktemp(prefix="pwtest-", suffix=".db")
os.environ["BASE_URL"] = "http://localhost:8080"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-bot"))

from cbor2 import dumps as cbor_dumps
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

import crypt_bot as cb

CHECKS = []


def ok(name, cond, detail=""):
    if not cond:
        raise AssertionError(f"{name}: {detail}")
    CHECKS.append(name)
    print(f"  ok  {name}")


# ------------------------- Синтетический аутентификатор ---------------------

class FakeAuthenticator:
    """P-256 аутентификатор: собирает authData/clientData и подписывает."""

    def __init__(self, user_verified=True):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.counter = 0
        self.user_verified = user_verified

    @staticmethod
    def _client_data(typ, challenge_b64, origin):
        return json.dumps(
            {"type": typ, "challenge": challenge_b64, "origin": origin,
             "crossOrigin": False},
            separators=(",", ":"),
        ).encode("utf-8")

    def _auth_data(self, with_cred):
        flags = 0x01 | (0x04 if self.user_verified else 0) | (0x40 if with_cred else 0)
        data = cb._rp_hash() + bytes([flags]) + self.counter.to_bytes(4, "big")
        if with_cred:
            numbers = self.key.public_key().public_numbers()
            cose = {
                1: 2, 3: -7, -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
            data += (
                bytes(16)
                + len(self.cred_id).to_bytes(2, "big")
                + self.cred_id
                + cbor_dumps(cose)
            )
        return data

    def create(self, challenge_b64, origin=None, user_verified=None):
        """Ответ navigator.credentials.create()."""
        if user_verified is None:
            user_verified = self.user_verified
        saved = self.user_verified
        self.user_verified = user_verified
        try:
            cdj = self._client_data("webauthn.create", challenge_b64, origin or cb.ORIGIN)
            auth = self._auth_data(True)
        finally:
            self.user_verified = saved
        attestation = cbor_dumps({"fmt": "none", "attStmt": {}, "authData": auth})
        return cdj, attestation

    def get(self, challenge_b64, counter=None, origin=None):
        """Ответ navigator.credentials.get()."""
        if counter is None:
            self.counter += 1
        else:
            self.counter = counter
        cdj = self._client_data("webauthn.get", challenge_b64, origin or cb.ORIGIN)
        auth = self._auth_data(False)
        signature = self.key.sign(
            auth + hashlib.sha256(cdj).digest(), ec.ECDSA(hashes.SHA256())
        )
        return cdj, auth, signature


# ------------------------------ Юнит-тесты ----------------------------------

def unit_tests():
    auth = FakeAuthenticator()
    challenge = cb._challenge_new("tok-unit", "register")

    cdj, attestation = auth.create(challenge)
    cred_id, public_key, alg, counter = cb.webauthn_register(cdj, attestation, challenge)
    ok("регистрация: ключ разобран", cred_id == cb._b64u(auth.cred_id) and alg == "ES256")
    ok("регистрация: счётчик 0", counter == 0)

    # вход с корректной подписью
    challenge2 = cb._challenge_new("tok-unit", "login")
    cdj2, auth_data, signature = auth.get(challenge2)
    new_counter = cb.webauthn_assert(cdj2, auth_data, signature, challenge2, public_key)
    ok("вход: подпись прошла, счётчик вырос", new_counter == 1)

    # не тот origin
    bad_cdj, bad_att = auth.create(challenge, origin="https://evil.example")
    try:
        cb.webauthn_register(bad_cdj, bad_att, challenge)
        ok("отказ по origin", False, "ошибки не было")
    except ValueError as exc:
        ok("отказ по origin", "origin" in str(exc).lower(), str(exc))

    # не тот challenge
    bad_cdj, bad_att = auth.create(cb._b64u(b"totally-different-challenge"))
    try:
        cb.webauthn_register(bad_cdj, bad_att, challenge)
        ok("отказ по challenge", False, "ошибки не было")
    except ValueError as exc:
        ok("отказ по challenge", "challenge" in str(exc).lower(), str(exc))

    # нет подтверждения пользователя (без биометрии/PIN)
    no_uv = FakeAuthenticator(user_verified=False)
    bad_cdj, bad_att = no_uv.create(challenge)
    try:
        cb.webauthn_register(bad_cdj, bad_att, challenge)
        ok("отказ без UV", False, "ошибки не было")
    except ValueError as exc:
        ok("отказ без UV", "Face ID" in str(exc), str(exc))

    # битая подпись
    challenge3 = cb._challenge_new("tok-unit", "login")
    cdj3, auth_data3, signature3 = auth.get(challenge3)
    tampered = bytearray(signature3)
    tampered[-1] ^= 0xFF
    try:
        cb.webauthn_assert(cdj3, auth_data3, bytes(tampered), challenge3, public_key)
        ok("отказ по подписи", False, "ошибки не было")
    except ValueError as exc:
        ok("отказ по подписи", "подпись" in str(exc).lower(), str(exc))

    # подпись от чужого ключа
    stranger = FakeAuthenticator()
    challenge4 = cb._challenge_new("tok-unit", "login")
    cdj4, auth_data4, signature4 = stranger.get(challenge4)
    try:
        cb.webauthn_assert(cdj4, auth_data4, signature4, challenge4, public_key)
        ok("отказ по чужому ключу", False, "ошибки не было")
    except ValueError as exc:
        ok("отказ по чужому ключу", "подпись" in str(exc).lower(), str(exc))

    # challenge одноразовый
    ch = cb._challenge_new("tok-unit", "register")
    ok("challenge берётся один раз", cb._challenge_take("tok-unit", "register", ch))
    ok("повторный challenge отклонён", not cb._challenge_take("tok-unit", "register", ch))
    ch2 = cb._challenge_new("tok-unit", "register")
    ok("challenge не гасится другим токеном",
       not cb._challenge_take("tok-other", "register", ch2))
    ok("а свой токен гасит", cb._challenge_take("tok-unit", "register", ch2))

    # обёртка кодового слова (продакшен-путь: pending -> vault)
    cb._pending_set("tok-unit", "pw")
    ok("pending: копия отложена", "tok-unit" in cb._pending_vault)
    ok("pending: перенос в vault", cb._pending_promote("tok-unit"))
    ok("vault: пароль возвращается", cb._vault_password(cb._vault_get("tok-unit")) == "pw")
    ok("pending: повторный перенос не проходит", not cb._pending_promote("tok-unit"))
    cb._db.execute("DELETE FROM vault WHERE token = 'tok-unit'")
    cb._db.commit()


# --------------------------- HTTP-сценарий (e2e) ----------------------------

def api_tests():
    """Полный проход через HTTP: FastAPI TestClient, без Telegram."""
    from fastapi.testclient import TestClient

    import time as time_mod
    from web_app import create_app

    password = "correct horse battery staple"
    plain = b"top secret payload\n" * 50
    encrypted = cb.encrypt_file_sync(plain, password)
    token = "tok-api-test-1"
    cb._db_add(token, "file-id-1", "отчёт.txt")

    class FakeBot:
        async def download(self, file_id, destination=None, **kwargs):
            assert file_id == "file-id-1", file_id
            destination.write(encrypted)

    app = create_app(FakeBot())
    paths = {getattr(r, "path", "") for r in app.routes}
    methods = [f"{sorted(r.methods)[0]} {r.path}" for r in app.routes
               if hasattr(r, "methods")]
    ok("сайт на FastAPI", app.__class__.__module__.startswith("fastapi"),
       app.__class__)
    ok("двенадцать маршрутов", len(methods) == 12, methods)
    ok("GET и POST на /d/{token} разделены",
       "/d/{token}" in paths and len(methods) == 12, methods)
    ok("маршрут /healthz есть", "/healthz" in paths, sorted(paths))
    ok("PWA-маршруты есть",
       all(p in paths for p in ("/manifest.webmanifest", "/sw.js",
                                "/icon-192.png", "/icon-512.png")),
       sorted(paths))

    time_shifted = False
    real_time = None
    with TestClient(app) as client:
        try:
            # 0. healthz
            r = client.get("/healthz")
            ok("healthz -> ok", r.status_code == 200 and r.json() == {"ok": True},
               r.status_code)

            # 0.1 PWA
            r = client.get("/manifest.webmanifest")
            ok("PWA: манифест отдаётся",
               r.status_code == 200 and r.json()["name"].startswith("Secret-bot")
               and r.json()["icons"], r.status_code)
            r = client.get("/sw.js")
            ok("PWA: service worker отдаётся",
               r.status_code == 200 and "caches" in r.text
               and "serviceWorker" not in r.text, r.status_code)
            for size in (192, 512):
                r = client.get(f"/icon-{size}.png")
                ok(f"PWA: иконка {size} отдаётся",
                   r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n",
                   r.status_code)

            # 1. страница без кук: только форма
            r = client.get(f"/d/{token}")
            text = r.text
            ok("страница открывается", r.status_code == 200, r.status_code)
            ok("форма с токеном", f'action="/d/{token}"' in text)
            ok("кнопок passkey до входа нет",
               'id="pw-setup"' not in text and 'id="pw-login"' not in text)
            ok("PWA: в странице манифест и тема",
               'rel="manifest"' in text and 'theme-color' in text)

            # 2. неверное кодовое слово
            r = client.post(f"/d/{token}", data={"password": "wrong"})
            ok("неверное слово -> 403", r.status_code == 403, r.status_code)

            # 3. регистрация до кодового слова запрещена
            r = client.post(f"/d/{token}/pw/register/options")
            ok("регистрация без кодового слова -> 403", r.status_code == 403,
               r.status_code)

            # 4. верное кодовое слово: файл + печать grant
            r = client.post(f"/d/{token}", data={"password": password})
            ok("верное слово -> файл",
               r.status_code == 200 and (r.content == plain), r.status_code)

            # Продолжаем «в будущем»: подпись куки не должна зависеть от секунды,
            # в которую её проверяют (иначе ловится только спустя ровно 0 секунд).
            real_time = time_mod.time
            time_mod.time = lambda: real_time() + 5
            time_shifted = True

            r = client.get(f"/d/{token}")
            text = r.text
            ok("после кодового слова появляется кнопка passkey",
               'id="pw-setup"' in text)

            # 5. options регистрации
            r = client.post(f"/d/{token}/pw/register/options")
            ok("register/options -> 200", r.status_code == 200, r.text)
            pub = r.json()["publicKey"]
            ok("rpId в options", pub["rp"]["id"] == cb.RP_ID, pub["rp"])
            ok("UV обязателен",
               pub["authenticatorSelection"]["userVerification"] == "required")

            auth = FakeAuthenticator()
            cdj, attestation = auth.create(pub["challenge"])
            payload = {
                "id": cb._b64u(auth.cred_id),
                "type": "public-key",
                "clientDataJSON": cb._b64u(cdj),
                "attestationObject": cb._b64u(attestation),
            }
            r = client.post(f"/d/{token}/pw/register/verify", json=payload)
            ok("register/verify -> 200", r.status_code == 200, r.text)
            ok("passkey сохранён", cb._pw_list(token) == [cb._b64u(auth.cred_id)],
               cb._pw_list(token))
            ok("ключ ссылки сохранён (vault)", cb._vault_get(token) is not None)

            # повтор того же ответа — challenge сгорел
            r = client.post(f"/d/{token}/pw/register/verify", json=payload)
            ok("повторная регистрация -> 400", r.status_code == 400, r.status_code)

            # 6. вход: сначала битая подпись
            r = client.post(f"/d/{token}/pw/login/options")
            ok("login/options -> 200", r.status_code == 200, r.text)
            pub = r.json()["publicKey"]
            cdj2, auth_data2, signature2 = auth.get(pub["challenge"])
            bad = bytes(bytearray(signature2)[:-1] + bytes([signature2[-1] ^ 0xFF]))
            r = client.post(f"/d/{token}/pw/login/verify", json={
                "id": cb._b64u(auth.cred_id), "type": "public-key",
                "clientDataJSON": cb._b64u(cdj2),
                "authenticatorData": cb._b64u(auth_data2),
                "signature": cb._b64u(bad),
            })
            ok("битая подпись -> 403", r.status_code == 403, r.status_code)

            # 7. честный вход
            r = client.post(f"/d/{token}/pw/login/options")
            pub = r.json()["publicKey"]
            cdj3, auth_data3, signature3 = auth.get(pub["challenge"])
            r = client.post(f"/d/{token}/pw/login/verify", json={
                "id": cb._b64u(auth.cred_id), "type": "public-key",
                "clientDataJSON": cb._b64u(cdj3),
                "authenticatorData": cb._b64u(auth_data3),
                "signature": cb._b64u(signature3),
            })
            ok("вход по passkey -> 200", r.status_code == 200, r.text)
            ok("счётчик записан",
               cb._pw_get(cb._b64u(auth.cred_id))[2] == auth.counter)

            # 8. файл по сессии passkey (без кодового слова)
            r = client.get(f"/d/{token}/get")
            ok("скачивание по сессии -> файл",
               r.status_code == 200 and (r.content == plain), r.status_code)

            # 9. страница показывает кнопку скачивания после входа
            r = client.get(f"/d/{token}")
            text = r.text
            ok("кнопка «скачать» после входа",
               "/get" in text and 'id="pw-login"' in text)

            # 10. клон ключа: тот же счётчик -> отказ
            r = client.post(f"/d/{token}/pw/login/options")
            pub = r.json()["publicKey"]
            cdj4, auth_data4, signature4 = auth.get(pub["challenge"],
                                                    counter=auth.counter)
            r = client.post(f"/d/{token}/pw/login/verify", json={
                "id": cb._b64u(auth.cred_id), "type": "public-key",
                "clientDataJSON": cb._b64u(cdj4),
                "authenticatorData": cb._b64u(auth_data4),
                "signature": cb._b64u(signature4),
            })
            ok("клон ключа (счётчик не вырос) -> 403", r.status_code == 403,
               r.status_code)

            # 11. без кук — файл не выдаём
            client.cookies.clear()
            r = client.get(f"/d/{token}/get")
            ok("без сессии -> 403", r.status_code == 403, r.status_code)
            r = client.post(f"/d/{token}/pw/register/options")
            ok("без grant регистрация снова запрещена", r.status_code == 403,
               r.status_code)

            # 12. неизвестная ссылка
            r = client.get("/d/no-such-token-here")
            ok("неизвестная ссылка -> 404", r.status_code == 404, r.status_code)
        finally:
            if time_shifted:
                time_mod.time = real_time


def static_tests():
    """Разбор исходников пакета: забытый await и ссылки между модулями.

    Проверка добавлена после живого бага: `has_pw = bool(db.passkey_list(t))`
    компилируется, но короутина всегда истинна, и кнопки passkey показывались
    всем, включая тех, кто кодовое слово не вводил. Ни код-ревью, ни запуск
    без Telegram такое не ловят — ловит вот эта проверка.
    """
    import ast

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-bot")
    files = ("config.py", "crypto.py", "database.py", "passkey.py",
             "private.py", "groups.py", "web_app.py", "crypt_bot.py", "launcher.py")

    trees, async_names, local_async = {}, set(), {}
    for name in files:
        with open(os.path.join(root, name), encoding="utf-8") as handle:
            tree = ast.parse(handle.read(), filename=name)
        trees[name] = tree
        local_async[name] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                async_names.add(node.name)
                local_async[name].add(node.name)
    ok("в пакете есть async-функции", len(async_names) > 20, len(async_names))

    # Родитель нужен, чтобы отличить `await f()` от голого `f()`
    # Функции, которые принимают корутину и берут её на себя: законно не await
    delegates = {"create_task", "gather", "ensure_future", "to_thread", "wait_for",
                 "shield", "run", "run_until_complete", "as_completed"}
    skipped = 0
    for name, tree in trees.items():
        parents = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                parents[id(child)] = node

        def delegated(node, parents=parents):
            """True, если корутина отдана кому-то (asyncio.run(f()) и т.п.)."""
            parent = parents.get(id(node))
            if isinstance(parent, ast.Await):
                return True
            # Поднимаемся по цепочке аргументов: f() внутри g(f()) -> g(...).
            while isinstance(parent, ast.Call) and node in parent.args:
                attr = (getattr(parent.func, "attr", None)
                        or getattr(parent.func, "id", None))
                if attr in delegates:
                    return True
                node, parent = parent, parents.get(id(parent))
            return False

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Attribute):
                called, known = node.func.attr, node.func.attr in async_names
            else:
                # Голое имя смотрим только среди async-функций ЭТОГО файла:
                # иначе `main()` в launcher.py (он синхронный) совпал бы
                # с async main() из crypt_bot.
                called = getattr(node.func, "id", None)
                known = called in local_async[name]
            if not known:
                continue
            if delegated(node):
                skipped += 1
                continue
            ok(f"{name}: {called}() без await", False, f"строка {node.lineno}")
    ok("передача корутины в asyncio.run/create_task уместна", skipped > 0, skipped)

    # Сайт не должен знать про бота: иначе снова получится монолит
    web = trees["web_app.py"]
    imports = {alias.name for node in ast.walk(web) if isinstance(node, ast.Import)
               for alias in node.names}
    ok("сайт не импортирует бота", "crypt_bot" not in imports, sorted(imports))
    ok("сайт импортирует модули пакета",
       {"config", "crypto", "database", "passkey"} <= imports, sorted(imports))


def link_tests():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-bot")

    def read(name):
        with open(os.path.join(root, name), encoding="utf-8") as handle:
            return handle.read()

    # Хендлеры бота разъехались по модулям, поэтому смотрим оба, а не один
    # файл: ссылка в личке и ссылка в группе живут в разных местах.
    private = read("private.py")
    groups = read("groups.py")
    anchor = 'f\'🔗 <a href="{html.escape(link)}">'
    ok("ссылка в личке — через <a href>", private.count(anchor) == 1,
       private.count(anchor))
    ok("ссылка в группе — тоже ссылка", f'f"🔗 {{link}}\\n\\n"' in groups
       and 'link = f"{BASE_URL}/d/{token}"' in groups)
    ok("в группе кодовое слово достаётся из БД",
       "await codeword_get(chat.id)" in groups)
    web = read("web_app.py")
    ok("кнопка «скачать» на странице — якорь", 'class="btn" href=' in web)
    # Сайт больше не знает про бота: он берёт из модулей только то, что нужно
    ok("сайт не импортирует crypt_bot", "import crypt_bot" not in web)
    ok("сайт и бот не ходят в базу синхронно", "asyncio.to_thread(cb." not in web)
    for name in ("crypt_bot.py", "web_app.py", "private.py", "groups.py"):
        src = read(name)
        # Проверяем не слово «aiohttp» вообще (оно осталось в комментариях
        # про историю переезда), а реальную зависимость: импорт или обращение.
        ok(f"в {name} остался aiohttp",
           "import aiohttp" not in src and "aiohttp." not in src,
           "остался импорт или вызов aiohttp")


def _free_port() -> int:
    """Свободный порт вместо зашитого 8123.

    На этой машине 8123 может быть отдан Hyper-V/WSL (WSAEACCES, а не
    «занят»), и жёсткий номер превращает прогон в лотерею.
    """
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def live_site_tests(port=None):
    """Живой uvicorn через cb.start_site/cb.stop_site — как в crypt_bot.main().

    Проверяет именно обвязку запуска: сайт встаёт в текущем цикле, отвечает
    по настоящему TCP и порт освобождается после остановки.
    """
    import asyncio

    import httpx

    port = port or _free_port()

    async def run():
        class DummyBot:
            pass

        server, task = await cb.start_site(DummyBot(), "127.0.0.1", port)
        ok("start_site вернул запущенный сервер", server.started)
        try:
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}", timeout=5
            ) as client:
                r = await client.get("/healthz")
                ok("живой сайт: /healthz 200", r.status_code == 200 and
                   r.json() == {"ok": True}, r.status_code)
                r = await client.get("/d/нет-такой-ссылки")
                ok("живой сайт: неизвестная ссылка 404", r.status_code == 404,
                   r.status_code)
        finally:
            await cb.stop_site(server, task)
        ok("после stop_site задача завершена", task.done())
        # порт должен быть свободен
        try:
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}", timeout=2
            ) as client:
                await client.get("/healthz")
            ok("порт освобождён после остановки", False, "сайт всё ещё отвечает")
        except (httpx.ConnectError, httpx.ConnectTimeout):
            ok("порт освобождён после остановки", True)
        except Exception as exc:
            ok("порт освобождён после остановки", False, repr(exc))

    asyncio.run(run())


def main():
    print("Юнит-тесты WebAuthn:")
    unit_tests()
    print("HTTP-сценарий (FastAPI TestClient):")
    api_tests()
    print("Живой сайт на uvicorn (обвязка запуска):")
    live_site_tests()
    print("Статика пакета:")
    static_tests()
    print("Кликабельные ссылки:")
    link_tests()
    print(f"\nВСЁ ПРОШЛО: {len(CHECKS)} проверок")


if __name__ == "__main__":
    main()
