"""Доказательство двух утверждений из резюме про anime-sync-api, а не пересказ README:

1. миграция Alembic действительно создаёт GIN-индекс полнотекстового поиска
   `ix_anime_title_fts` на живой PostgreSQL;
2. тесты проходят не только на SQLite, но и на PostgreSQL — как в CI.

Запуск (venv с зависимостями проекта, БД поднята локально):
    python verify-anime-pg.py

Скрипт ничего не оставляет: база `anime_verify` удаляется в конце.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROJECT = Path(r"D:\SOOBSHESTVA\AUTOMATIC\RABOTA_API\anime-sync-api")
HOST, PORT = "127.0.0.1", "5434"
ADMIN = "postgresql://postgres:postgres@127.0.0.1:5434/postgres"
DB = "anime_verify"
failures: list[str] = []


def sh(cmd: list[str], **kw: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=PROJECT, capture_output=True, text=True, **kw)  # noqa: S603


os.chdir(PROJECT)
os.environ["DATABASE_URL"] = f"postgresql+asyncpg://postgres:postgres@{HOST}:{PORT}/{DB}"
os.environ["ALEMBIC_DATABASE_URL"] = f"postgresql+psycopg://postgres:postgres@{HOST}:{PORT}/{DB}"

import psycopg  # noqa: E402

print("1. создаю временную базу")
with psycopg.connect(ADMIN, autocommit=True) as conn:
    conn.execute(f'DROP DATABASE IF EXISTS "{DB}"')
    conn.execute(f'CREATE DATABASE "{DB}"')
print(f"   {DB} создана на {HOST}:{PORT}")

try:
    print("\n2. alembic upgrade head")
    up = sh([sys.executable, "-m", "alembic", "upgrade", "head"])
    print("   " + (up.stdout.strip().splitlines() or ["(без вывода)"])[-1])
    if up.returncode != 0:
        failures.append("alembic upgrade упал: " + up.stderr.strip()[-300:])

    print("\n3. что появилось в схеме")
    with psycopg.connect(f"postgresql://postgres:postgres@{HOST}:{PORT}/{DB}") as conn:
        tables = [r[0] for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").fetchall()]
        idx = [r[0] for r in conn.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1").fetchall()]
        gin = [r[0] for r in conn.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname='public' "
            "AND indexdef ILIKE '%USING gin%' ORDER BY 1").fetchall()]
    print(f"   таблиц: {tables}")
    print(f"   GIN-индексов: {gin}")
    if "anime" not in tables:
        failures.append(f"нет таблицы anime: {tables}")
    if "ix_anime_title_fts" not in idx:
        failures.append("нет индекса ix_anime_title_fts — утверждение о полнотекстовом поиске неверно")
    if not gin:
        failures.append("GIN-индексов нет вовсе")

    print("\n4. pytest на PostgreSQL")
    test = sh([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"])
    tail = (test.stdout.strip().splitlines() or ["(пусто)"])[-1]
    print(f"   {tail}")
    if test.returncode != 0:
        failures.append("тесты на PostgreSQL не прошли: " + (test.stdout + test.stderr).strip()[-400:])

    print("\n5. ruff")
    lint = sh([sys.executable, "-m", "ruff", "check", "app", "tests", "alembic"])
    print("   " + (lint.stdout.strip().splitlines() or ["(без вывода)"])[-1])
    if lint.returncode != 0:
        failures.append("ruff нашёл нарушения: " + lint.stdout.strip()[-300:])
finally:
    print("\n6. убираю временную базу")
    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s", (DB,))
        conn.execute(f'DROP DATABASE IF EXISTS "{DB}"')
    print(f"   {DB} удалена")

print("\nитог:", "ВСЁ ПОДТВЕРЖДЕНО" if not failures else "РАСХОЖДЕНИЯ")
for f in failures:
    print("  !", f)
sys.exit(1 if failures else 0)