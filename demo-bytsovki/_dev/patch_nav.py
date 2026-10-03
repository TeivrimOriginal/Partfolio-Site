#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Обновляет блок навигации в header на всех страницах прототипа.
Запуск: python _dev/patch_nav.py
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NAV_MAIN = """      <a href="catalog.html">Каталог</a>
      <a href="calc.html">Калькулятор</a>
      <a href="delivery.html">Доставка и монтаж</a>
      <a href="about.html">О компании</a>
      <a href="index.html#examples">Примеры работ</a>
      <a href="index.html#request">Контакты</a>"""

NAV_404 = """      <a href="catalog.html">Каталог</a>
      <a href="calc.html">Калькулятор</a>
      <a href="index.html#request">Контакты</a>"""

# файл -> (старые строки навигации, новый блок)
PATCH = {
    "index.html": (
        ['      <a href="catalog.html">Каталог</a>',
         '      <a href="#calc">Калькулятор</a>',
         '      <a href="#stages">Как мы работаем</a>',
         '      <a href="#examples">Примеры работ</a>',
         '      <a href="#request">Контакты</a>'],
        NAV_MAIN),
    "catalog.html": (
        ['      <a href="catalog.html">Каталог</a>',
         '      <a href="index.html#calc">Калькулятор</a>',
         '      <a href="index.html#stages">Как мы работаем</a>',
         '      <a href="index.html#examples">Примеры работ</a>',
         '      <a href="index.html#request">Контакты</a>'],
        NAV_MAIN),
    "product.html": (
        ['      <a href="catalog.html">Каталог</a>',
         '      <a href="index.html#calc">Калькулятор</a>',
         '      <a href="index.html#stages">Как мы работаем</a>',
         '      <a href="index.html#examples">Примеры работ</a>',
         '      <a href="index.html#request">Контакты</a>'],
        NAV_MAIN),
    "404.html": (
        ['      <a href="catalog.html">Каталог</a>',
         '      <a href="index.html#calc">Калькулятор</a>',
         '      <a href="index.html#request">Контакты</a>'],
        NAV_404),
}


def main():
    for name, (old_lines, new_block) in PATCH.items():
        path = os.path.join(ROOT, name)
        with io.open(path, encoding="utf-8") as f:
            html = f.read()
        if new_block.split("\n")[1] in html:
            print("{0:16} уже обновлён".format(name))
            continue
        # найти непрерывный блок старых ссылок
        joined = "\n".join(old_lines)
        if joined not in html:
            print("{0:16} НЕ НАЙДЕН блок — проверь вручную".format(name))
            continue
        html = html.replace(joined, new_block, 1)
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print("{0:16} навигация обновлена".format(name))


if __name__ == "__main__":
    main()