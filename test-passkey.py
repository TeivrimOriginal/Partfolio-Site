"""Проверка passkey-интеграции и кликабельных ссылок в secret-bot/crypt_bot.py.

Запуск: python test-passkey.py

Что проверяется:
1. Разбор WebAuthn-ответов синтетическим аутентификатором (создание и вход),
   включая отказы: не тот origin, не тот challenge, битая подпись, нет UV.
2. Одноразовость challenge.
3. Полный проход по HTTP: страница -> неверное слово -> верное слово ->
   регистрация passkey -> вход по passkey -> скачивание файла по сессии.
4. Отказ без сессии и отказ по клону ключа (счётчик не вырос).
5. Ссылки в сообщениях бота собраны через <a href>.
"""

import asyncio
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

async def api_tests():
    from aiohttp.test_utils import TestClient, TestServer

    password = "correct horse battery staple"
    plain = b"top secret payload\n" * 50
    encrypted = cb.encrypt_file(plain, password)
    token = "tok-api-test-1"
    cb._db_add(token, "file-id-1", "отчёт.txt")

    class FakeBot:
        async def download(self, file_id, destination=None, **kwargs):
            assert file_id == "file-id-1", file_id
            destination.write(encrypted)

    app = cb.build_web_app(FakeBot())
    client = TestClient(TestServer(app, host="localhost"))
    await client.start_server()
    time_shifted = False
    real_time = None
    try:
        # 1. страница без кук: только форма
        r = await client.get(f"/d/{token}")
        text = await r.text()
        ok("страница открывается", r.status == 200, r.status)
        ok("форма с токеном", f'action="/d/{token}"' in text)
        ok("кнопок passkey до входа нет",
           'id="pw-setup"' not in text and 'id="pw-login"' not in text)

        # 2. неверное кодовое слово
        r = await client.post(f"/d/{token}", data={"password": "wrong"})
        ok("неверное слово -> 403", r.status == 403, r.status)

        # 3. регистрация до кодового слова запрещена
        r = await client.post(f"/d/{token}/pw/register/options")
        ok("регистрация без кодового слова -> 403", r.status == 403, r.status)

        # 4. верное кодовое слово: файл + печать grant
        r = await client.post(f"/d/{token}", data={"password": password})
        ok("верное слово -> файл", r.status == 200 and (await r.read() == plain), r.status)

        # Продолжаем «в будущем»: подпись куки не должна зависеть от секунды,
        # в которую её проверяют (иначе ловится только спустя ровно 0 секунд).
        import time as time_mod
        real_time = time_mod.time
        time_mod.time = lambda: real_time() + 5
        time_shifted = True

        r = await client.get(f"/d/{token}")
        text = await r.text()
        ok("после кодового слова появляется кнопка passkey", 'id="pw-setup"' in text)

        # 5. options регистрации
        r = await client.post(f"/d/{token}/pw/register/options")
        ok("register/options -> 200", r.status == 200, await r.text())
        pub = (await r.json())["publicKey"]
        ok("rpId в options", pub["rp"]["id"] == cb.RP_ID, pub["rp"])
        ok("UV обязателен", pub["authenticatorSelection"]["userVerification"] == "required")

        auth = FakeAuthenticator()
        cdj, attestation = auth.create(pub["challenge"])
        payload = {
            "id": cb._b64u(auth.cred_id),
            "type": "public-key",
            "clientDataJSON": cb._b64u(cdj),
            "attestationObject": cb._b64u(attestation),
        }
        r = await client.post(f"/d/{token}/pw/register/verify", json=payload)
        ok("register/verify -> 200", r.status == 200, await r.text())
        ok("passkey сохранён", cb._pw_list(token) == [cb._b64u(auth.cred_id)],
           cb._pw_list(token))
        ok("ключ ссылки сохранён (vault)", cb._vault_get(token) is not None)

        # повтор того же ответа — challenge сгорел
        r = await client.post(f"/d/{token}/pw/register/verify", json=payload)
        ok("повторная регистрация -> 400", r.status == 400, r.status)

        # 6. вход: сначала битая подпись
        r = await client.post(f"/d/{token}/pw/login/options")
        ok("login/options -> 200", r.status == 200, await r.text())
        pub = (await r.json())["publicKey"]
        cdj2, auth_data2, signature2 = auth.get(pub["challenge"])
        bad = bytes(bytearray(signature2)[:-1] + bytes([signature2[-1] ^ 0xFF]))
        r = await client.post(f"/d/{token}/pw/login/verify", json={
            "id": cb._b64u(auth.cred_id), "type": "public-key",
            "clientDataJSON": cb._b64u(cdj2),
            "authenticatorData": cb._b64u(auth_data2),
            "signature": cb._b64u(bad),
        })
        ok("битая подпись -> 403", r.status == 403, r.status)

        # 7. честный вход
        r = await client.post(f"/d/{token}/pw/login/options")
        pub = (await r.json())["publicKey"]
        cdj3, auth_data3, signature3 = auth.get(pub["challenge"])
        r = await client.post(f"/d/{token}/pw/login/verify", json={
            "id": cb._b64u(auth.cred_id), "type": "public-key",
            "clientDataJSON": cb._b64u(cdj3),
            "authenticatorData": cb._b64u(auth_data3),
            "signature": cb._b64u(signature3),
        })
        ok("вход по passkey -> 200", r.status == 200, await r.text())
        ok("счётчик записан", cb._pw_get(cb._b64u(auth.cred_id))[2] == auth.counter)

        # 8. файл по сессии passkey (без кодового слова)
        r = await client.get(f"/d/{token}/get")
        ok("скачивание по сессии -> файл",
           r.status == 200 and (await r.read() == plain), r.status)

        # 9. страница показывает кнопку скачивания после входа
        r = await client.get(f"/d/{token}")
        text = await r.text()
        ok("кнопка «скачать» после входа", "/get" in text and 'id="pw-login"' in text)

        # 10. клон ключа: тот же счётчик -> отказ
        r = await client.post(f"/d/{token}/pw/login/options")
        pub = (await r.json())["publicKey"]
        cdj4, auth_data4, signature4 = auth.get(pub["challenge"], counter=auth.counter)
        r = await client.post(f"/d/{token}/pw/login/verify", json={
            "id": cb._b64u(auth.cred_id), "type": "public-key",
            "clientDataJSON": cb._b64u(cdj4),
            "authenticatorData": cb._b64u(auth_data4),
            "signature": cb._b64u(signature4),
        })
        ok("клон ключа (счётчик не вырос) -> 403", r.status == 403, r.status)

        # 11. без кук — файл не выдаём
        client.session.cookie_jar.clear()
        r = await client.get(f"/d/{token}/get")
        ok("без сессии -> 403", r.status == 403, r.status)
        r = await client.post(f"/d/{token}/pw/register/options")
        ok("без grant регистрация снова запрещена", r.status == 403, r.status)
    finally:
        if time_shifted:
            time_mod.time = real_time
        await client.close()


def link_tests():
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "secret-bot", "crypt_bot.py"), encoding="utf-8").read()
    anchors = src.count('f\'🔗 <a href="{html.escape(link)}">')
    ok("ссылки в личке и в группе — через <a href>", anchors == 2, anchors)
    ok("кнопка «скачать» на странице — якорь", 'class="btn" href=' in src)


def main():
    print("Юнит-тесты WebAuthn:")
    unit_tests()
    print("HTTP-сценарий:")
    asyncio.run(api_tests())
    print("Кликабельные ссылки:")
    link_tests()
    print(f"\nВСЁ ПРОШЛО: {len(CHECKS)} проверок")


if __name__ == "__main__":
    main()
