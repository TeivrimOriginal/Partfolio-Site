#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор иллюстраций для демо-сайта по продаже деревянных бытовок.
Всё рисуется в SVG: файлы весят килобайты, грузятся мгновенно, масштабируются
без потери качества и не занимают место на диске C:.
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")

PALETTES = {
    "pine":    {"body": "#c9a06a", "plank": "#a97f4c", "post": "#8a6236", "roof": "#5d4630", "trim": "#f3ece0"},
    "spruce":  {"body": "#d7b382", "plank": "#b98f5c", "post": "#96703f", "roof": "#4f4130", "trim": "#f7f1e6"},
    "frame":   {"body": "#d8c8ac", "plank": "#bda684", "post": "#8f7a5a", "roof": "#5a4a38", "trim": "#efe8db"},
    "larch":   {"body": "#c08a52", "plank": "#9d6a38", "post": "#7d5228", "roof": "#4d3b2a", "trim": "#f2e9dc"},
}


def scene_start(w, h):
    return f'<rect width="{w}" height="{h}" fill="url(#sky)"/>'


def ground_band(w, y, h, grass="#c2cfa4", soil="#ab9578"):
    out = [f'<rect x="0" y="{y}" width="{w}" height="{h - y}" fill="{grass}"/>']
    out.append(f'<path d="M0 {y + 26} H{w} V{h} H0 Z" fill="{soil}"/>')
    # травинки
    out.append(f'<g stroke="#93a877" stroke-width="3" opacity="0.6">')
    step = 40
    x = 12
    while x < w:
        out.append(f'<path d="M{x} {y + 24} l4 -12 l3 12"/>')
        x += step
    out.append("</g>")
    return "".join(out)


def shadow(w, cx, cy, rx, ry):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#000" opacity="0.13"/>'


def planks(x, y, w, h, pal, step=16):
    """Горизонтальные доски на стене."""
    out = [f'<g stroke="{pal["plank"]}" stroke-width="1.6" opacity="0.55">']
    yy = y + step
    while yy < y + h - 2:
        out.append(f'<line x1="{x}" y1="{yy}" x2="{x + w}" y2="{yy}"/>')
        yy += step
    out.append("</g>")
    return "".join(out)


def window_(x, y, w, h, mullions=True):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="url(#glass)" stroke="#6b533a" stroke-width="4"/>']
    if mullions:
        out.append(f'<line x1="{x + w / 2}" y1="{y}" x2="{x + w / 2}" y2="{y + h}" stroke="#6b533a" stroke-width="3"/>')
        out.append(f'<line x1="{x}" y1="{y + h / 2}" x2="{x + w}" y2="{y + h / 2}" stroke="#6b533a" stroke-width="3"/>')
    # блик
    out.append(f'<path d="M{x + 6} {y + h - 8} L{x + w - 8} {y + 6}" stroke="#ffffff" stroke-width="4" opacity="0.45"/>')
    return "".join(out)


def door(x, y, w, h):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#a97f4c" stroke="#6b533a" stroke-width="4"/>']
    out.append(f'<g stroke="#8a6236" stroke-width="1.6" opacity="0.7">')
    yy = y + 12
    while yy < y + h - 4:
        out.append(f'<line x1="{x + 4}" y1="{yy}" x2="{x + w - 4}" y2="{yy}"/>')
        yy += 13
    out.append("</g>")
    out.append(f'<circle cx="{x + w - 12}" cy="{y + h / 2}" r="4" fill="#e8dcc4" stroke="#6b533a" stroke-width="1.5"/>')
    out.append(f'<rect x="{x + 2}" y="{y - 4}" width="{w - 4}" height="8" fill="#8a6236"/>')
    return "".join(out)


def cabin(w=800, h=600, pal_key="pine", body_w=470, body_h=235, base_y=470,
          windows=2, door_on=True, roof_overhang=26, piles=True, steps=True, veranda=False):
    """Основной вид изделия: стена, окна, дверь, крыша."""
    pal = PALETTES[pal_key]
    x = (w - body_w) // 2
    y = base_y - body_h
    out = [scene_start(w, h), ground_band(w, base_y - 6, h)]
    if piles:
        for i in range(5):
            px = x + 26 + i * (body_w - 52) / 4
            out.append(f'<rect x="{px - 9}" y="{base_y}" width="18" height="{h - base_y}" fill="#8a7a63"/>')
    out.append(shadow(w, w / 2, base_y + 22, body_w / 2 + 30, 20))
    # тело
    out.append(f'<rect x="{x}" y="{y}" width="{body_w}" height="{body_h}" fill="url(#wood)"/>')
    out.append(planks(x, y, body_w, body_h, pal))
    # угловые столбы
    out.append(f'<rect x="{x}" y="{y}" width="16" height="{body_h}" fill="{pal["post"]}"/>')
    out.append(f'<rect x="{x + body_w - 16}" y="{y}" width="16" height="{body_h}" fill="{pal["post"]}"/>')
    # нижняя обвязка
    out.append(f'<rect x="{x - 6}" y="{y + body_h - 18}" width="{body_w + 12}" height="18" fill="{pal["post"]}"/>')
    # крыша (двускатная)
    ridge_y = y - 78
    out.append(f'<path d="M{x - roof_overhang} {y + 6} L{w / 2} {ridge_y} L{x + body_w + roof_overhang} {y + 6} Z" '
               f'fill="{pal["roof"]}"/>')
    out.append(f'<path d="M{x - roof_overhang} {y + 6} L{w / 2} {ridge_y}" stroke="#3c2c1e" stroke-width="3" fill="none"/>')
    out.append(f'<path d="M{x + body_w + roof_overhang} {y + 6} L{w / 2} {ridge_y}" stroke="#3c2c1e" stroke-width="3" fill="none"/>')
    # конёк
    out.append(f'<rect x="{w / 2 - 60}" y="{ridge_y - 8}" width="120" height="10" rx="4" fill="#3c2c1e"/>')
    # окна
    win_w, win_h = 96, 84
    gap = 34
    total = windows * win_w + (windows - 1) * gap
    start = x + (body_w - total) / 2
    for i in range(windows):
        out.append(window_(start + i * (win_w + gap), y + 58, win_w, win_h))
        out.append(f'<rect x="{start + i * (win_w + gap) - 6}" y="{y + 50}" width="{win_w + 12}" height="10" fill="{pal["trim"]}"/>')
    # дверь
    if door_on:
        dw, dh = 104, 178
        dx = x + body_w - dw - 34
        out.append(door(dx, y + body_h - dh, dw, dh))
        if steps:
            out.append(f'<rect x="{dx - 14}" y="{base_y}" width="{dw + 28}" height="12" fill="#b9ab93"/>')
            out.append(f'<rect x="{dx - 24}" y="{base_y + 12}" width="{dw + 48}" height="12" fill="#a9977f"/>')
    if veranda:
        vy = y + body_h
        out.append(f'<rect x="{x - 40}" y="{vy + 66}" width="{body_w + 80}" height="14" fill="{pal["trim"]}"/>')
        for px in (x - 32, x + body_w - 8):
            out.append(f'<rect x="{px}" y="{vy + 6}" width="14" height="62" fill="{pal["post"]}"/>')
    return "".join(out)


def interior(w=800, h=600, pal_key="pine", body_w=470, body_h=250, base_y=470):
    """Разрез: видно утеплитель, стойки, пол и стропила."""
    pal = PALETTES[pal_key]
    x = (w - body_w) // 2
    y = base_y - body_h
    ridge = y - 74
    out = [scene_start(w, h), ground_band(w, base_y - 6, h), shadow(w, w / 2, base_y + 22, body_w / 2 + 30, 20)]
    # стена слоями: наружная обшивка, утеплитель, стойки, внутренняя обшивка
    out.append(f'<rect x="{x}" y="{y}" width="{body_w}" height="{body_h}" fill="{pal["body"]}"/>')
    out.append(f'<rect x="{x}" y="{y}" width="70" height="{body_h}" fill="{pal["body"]}"/>')
    out.append(f'<rect x="{x + 70}" y="{y}" width="62" height="{body_h}" fill="#f2d98a" opacity="0.85"/>')
    # стойки
    for i in range(1, 6):
        sx = x + 70 + 62 + (body_w - 132) / 5 * i - 8
        out.append(f'<rect x="{sx:.0f}" y="{y}" width="16" height="{body_h}" fill="{pal["post"]}"/>')
    out.append(f'<rect x="{x + body_w - 62}" y="{y}" width="62" height="{body_h}" fill="#e6d3b4"/>')
    out.append(planks(x + body_w - 62, y, 62, body_h, pal))
    # подпись слоёв
    out.append(f'<g font-family="Arial, sans-serif" font-size="17" fill="#4b3a26">'
               f'<text x="{x + 20}" y="{y + 30}">обшивка</text>'
               f'<text x="{x + 78}" y="{y + 30}">утеплитель</text>'
               f'<text x="{x + body_w - 56}" y="{y + 30}">внутри</text>'
               f'</g>')
    # пол
    out.append(f'<rect x="{x}" y="{y + body_h - 16}" width="{body_w}" height="16" fill="#8a7a63"/>')
    # стропила
    out.append(f'<path d="M{x} {y + 8} L{w / 2} {ridge} L{x + body_w} {y + 8}" fill="none" stroke="{pal["roof"]}" stroke-width="12"/>')
    out.append(f'<rect x="{w / 2 - 7}" y="{ridge}" width="14" height="{body_h}" fill="{pal["post"]}" opacity="0.5"/>')
    # окно внутри
    out.append(window_(x + body_w - 148, y + 60, 78, 70))
    # внутренняя мебель: полка и верстак
    out.append(f'<rect x="{x + 22}" y="{y + body_h - 92}" width="150" height="10" fill="#b98f5c"/>')
    out.append(f'<rect x="{x + 34}" y="{y + body_h - 82}" width="10" height="66" fill="#b98f5c"/>')
    out.append(f'<rect x="{x + 150}" y="{y + body_h - 82}" width="10" height="66" fill="#b98f5c"/>')
    return "".join(out)


def frame_view(w=800, h=600, pal_key="frame", body_w=470, body_h=235, base_y=470):
    """Каркас без обшивки: стойки, обвязки, стропильная система."""
    pal = PALETTES[pal_key]
    x = (w - body_w) // 2
    y = base_y - body_h
    ridge = y - 74
    out = [scene_start(w, h), ground_band(w, base_y - 6, h), shadow(w, w / 2, base_y + 22, body_w / 2 + 30, 20)]
    n = 8
    for i in range(n + 1):
        sx = x + body_w * i / n
        out.append(f'<rect x="{sx - 9:.0f}" y="{y}" width="18" height="{body_h}" fill="{pal["post"]}"/>')
    for yy in (y, y + body_h / 2, y + body_h - 18):
        out.append(f'<rect x="{x}" y="{yy:.0f}" width="{body_w}" height="16" fill="{pal["body"]}"/>')
    # стропила
    out.append(f'<path d="M{x} {y} L{w / 2} {ridge} L{x + body_w} {y}" fill="none" stroke="{pal["roof"]}" stroke-width="14"/>')
    for i in range(1, 6):
        cx = x + body_w * i / 6
        t = i / 6
        top_y = ridge + (y - ridge) * (2 * abs(t - 0.5))
        out.append(f'<rect x="{cx - 6:.0f}" y="{top_y:.0f}" width="12" height="{y + body_h - top_y:.0f}" fill="{pal["body"]}" opacity="0.9"/>')
    out.append(f'<rect x="{w / 2 - 8}" y="{ridge}" width="16" height="{body_h + 74}" fill="{pal["post"]}" opacity="0.55"/>')
    # обрешётка кровли
    out.append(f'<path d="M{x - 20} {y} L{w / 2} {ridge - 12} L{x + body_w + 20} {y}" fill="none" stroke="#8a7a63" stroke-width="6"/>')
    return "".join(out)


def outhouse(w=600, h=450, pal_key="larch", body_w=250, body_h=210, base_y=330, vent=True, door_w=78):
    """Хозблок / туалет: небольшая постройка с вентиляционной трубой."""
    pal = PALETTES[pal_key]
    x = (w - body_w) // 2
    y = base_y - body_h
    out = [scene_start(w, h), ground_band(w, base_y - 4, h), shadow(w, w / 2, base_y + 16, body_w / 2 + 20, 14)]
    out.append(f'<rect x="{x}" y="{y}" width="{body_w}" height="{body_h}" fill="url(#wood)"/>')
    out.append(planks(x, y, body_w, body_h, pal, step=14))
    out.append(f'<rect x="{x}" y="{y}" width="14" height="{body_h}" fill="{pal["post"]}"/>')
    out.append(f'<rect x="{x + body_w - 14}" y="{y}" width="14" height="{body_h}" fill="{pal["post"]}"/>')
    ridge = y - 46
    out.append(f'<path d="M{x - 18} {y + 4} L{w / 2} {ridge} L{x + body_w + 18} {y + 4} Z" fill="{pal["roof"]}"/>')
    out.append(f'<rect x="{w / 2 - 40}" y="{ridge - 6}" width="80" height="8" rx="3" fill="#3c2c1e"/>')
    out.append(door(x + (body_w - door_w) / 2, y + body_h - 156, door_w, 156))
    out.append(f'<rect x="{x + (body_w - door_w) / 2 - 10}" y="{base_y}" width="{door_w + 20}" height="10" fill="#b9ab93"/>')
    if vent:
        vx = x + body_w - 34
        out.append(f'<rect x="{vx}" y="{ridge - 62}" width="16" height="70" fill="#8d9199"/>')
        out.append(f'<path d="M{vx - 12} {ridge - 62} h40 l-20 -22 z" fill="#8d9199"/>')
    return "".join(out)


def swing(w=600, h=450):
    """Качели садовые: А-образная рама, сиденье, навес."""
    out = [scene_start(w, h), ground_band(w, 350, h)]
    out.append(shadow(w, w / 2, 372, 190, 16))
    cx = w / 2
    top = 108
    out.append(f'<g stroke="#8a6236" stroke-width="16" stroke-linecap="round">'
               f'<line x1="{cx - 130}" y1="368" x2="{cx}" y2="{top}"/>'
               f'<line x1="{cx + 130}" y1="368" x2="{cx}" y2="{top}"/>'
               f'</g>')
    out.append(f'<g stroke="#a97f4c" stroke-width="10" stroke-linecap="round">'
               f'<line x1="{cx - 104}" y1="368" x2="{cx - 62}" y2="250"/>'
               f'<line x1="{cx + 104}" y1="368" x2="{cx + 62}" y2="250"/>'
               f'</g>')
    out.append(f'<rect x="{cx - 76}" y="236" width="152" height="16" rx="6" fill="#b98f5c" stroke="#6b533a" stroke-width="3"/>')
    for dx in (-52, 0, 52):
        out.append(f'<line x1="{cx + dx}" y1="212" x2="{cx + dx}" y2="236" stroke="#8a6236" stroke-width="6"/>')
    out.append(f'<g stroke="#8a6236" stroke-width="8" stroke-linecap="round">'
               f'<line x1="{cx - 150}" y1="196" x2="{cx + 150}" y2="196"/></g>')
    out.append(f'<g stroke="#a97f4c" stroke-width="5" opacity="0.9">'
               f'<line x1="{cx - 150}" y1="196" x2="{cx - 60}" y2="{top + 6}"/>'
               f'<line x1="{cx + 150}" y1="196" x2="{cx + 60}" y2="{top + 6}"/></g>')
    for x0 in (cx - 120, cx + 120):
        out.append(f'<line x1="{x0}" y1="196" x2="{x0}" y2="236" stroke="#8a6236" stroke-width="5"/>')
    out.append(f'<path d="M{cx - 168} {196} L{cx} {top - 6} L{cx + 168} {196} Z" fill="#4d3b2a" opacity="0.92"/>')
    out.append(f'<rect x="{cx - 60}" y="{top - 14}" width="120" height="8" rx="3" fill="#3c2c1e"/>')
    out.append(f'<rect x="{cx - 46}" y="300" width="92" height="66" rx="6" fill="#a97f4c" stroke="#6b533a" stroke-width="3"/>')
    out.append(f'<line x1="{cx - 46}" y1="334" x2="{cx + 46}" y2="334" stroke="#8a6236" stroke-width="4"/>')
    out.append(f'<path d="M{cx - 46} {332} q46 -22 92 0" fill="#8fbf8a" opacity="0.85"/>')
    return "".join(out)


DEFS = (
    '<defs>'
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="#e9f1f6"/><stop offset="1" stop-color="#f8f1e4"/>'
    '</linearGradient>'
    '<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="#d3aa72"/><stop offset="1" stop-color="#a97f4c"/>'
    '</linearGradient>'
    '<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#e2edf4"/><stop offset="1" stop-color="#a9c6d8"/>'
    '</linearGradient>'
    '</defs>'
)


def wrap(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'{DEFS}{body}</svg>')


def write(name, content):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"{name:34} {os.path.getsize(path):7d} bytes")


def main():
    os.makedirs(OUT, exist_ok=True)

    # Карточка товара: 4 фото одного изделия (бытовка 6x3, утеплённая)
    body = cabin(w=800, h=600, pal_key="pine", body_w=470, body_h=235, windows=2, veranda=True)
    write("bytovka-front.svg", wrap(800, 600, body))
    # вид сбоку
    body = cabin(w=800, h=600, pal_key="pine", body_w=380, body_h=235, windows=1, door_on=False, veranda=False)
    write("bytovka-side.svg", wrap(800, 600, body))
    # внутренний вид
    write("bytovka-inside.svg", wrap(800, 600, interior(800, 600, "pine")))
    # каркас
    write("bytovka-frame.svg", wrap(800, 600, frame_view(800, 600, "frame")))
    # хозблок и туалет
    write("hozhblok.svg", wrap(600, 450, outhouse(600, 450, "larch", 250, 210, 330)))
    write("tualet.svg", wrap(600, 450, outhouse(600, 450, "pine", 190, 205, 330, vent=True)))
    # качели
    write("kacheli.svg", wrap(600, 450, swing(600, 450)))
    # категории для главной (широкие)
    body = cabin(w=600, h=420, pal_key="pine", body_w=340, body_h=175, base_y=330, windows=2, veranda=False)
    write("cat-bytovka.svg", wrap(600, 420, body))
    body = cabin(w=600, h=420, pal_key="spruce", body_w=300, body_h=170, base_y=330, windows=2, door_on=True)
    write("cat-bystrovka-2.svg", wrap(600, 420, body))
    write("cat-hozhblok.svg", wrap(600, 420, outhouse(600, 420, "larch", 230, 185, 320)))
    write("cat-tualet.svg", wrap(600, 420, outhouse(600, 420, "spruce", 175, 180, 320)))
    write("cat-kacheli.svg", wrap(600, 420, swing(600, 420)))
    # hero-фон
    write("hero.svg", wrap(1200, 560, cabin(1200, 560, "pine", 640, 300, base_y=460, windows=3, veranda=True)))
    # favicon
    write("favicon.svg", wrap(64, 64,
          '<rect width="64" height="64" rx="12" fill="#8a6236"/>'
          '<path d="M12 34 L32 18 L52 34 L52 50 L12 50 Z" fill="#f3ece0"/>'
          '<rect x="26" y="34" width="12" height="16" fill="#8a6236"/>'))


if __name__ == "__main__":
    main()