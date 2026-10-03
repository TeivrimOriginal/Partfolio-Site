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




# ---------- Чертёжная часть: план-кровля и разрез ----------
DRAW_DEFS = (
    '<defs>'
    '<pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">'
    '<path d="M20 0 L0 0 0 20" fill="none" stroke="#dfe6ee" stroke-width="1"/>'
    '</pattern>'
    '<marker id="ar" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
    '<path d="M0 0 L9 4.5 L0 9 z" fill="#2f6f4f"/></marker>'
    '<marker id="ar2" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto">'
    '<path d="M9 0 L0 4.5 L9 9 z" fill="#2f6f4f"/></marker>'
    '</defs>'
)


def sheet(w, h):
    return (f'<rect width="{w}" height="{h}" fill="#fbfcfe"/>'
            f'<rect width="{w}" height="{h}" fill="url(#grid)"/>')


def dim_h(x1, x2, y, label, tick=10):
    return (f'<g stroke="#2f6f4f" stroke-width="1.6" fill="none">'
            f'<line x1="{x1}" y1="{y - tick / 2}" x2="{x1}" y2="{y + tick / 2}"/>'
            f'<line x1="{x2}" y1="{y - tick / 2}" x2="{x2}" y2="{y + tick / 2}"/>'
            f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" marker-start="url(#ar2)" marker-end="url(#ar)"/></g>'
            f'<text x="{(x1 + x2) / 2}" y="{y - 8}" font-size="17" fill="#1f5136" '
            f'text-anchor="middle">{label}</text>')


def dim_v(y1, y2, x, label, tick=10):
    cy = (y1 + y2) / 2
    return (f'<g stroke="#2f6f4f" stroke-width="1.6" fill="none">'
            f'<line x1="{x - tick / 2}" y1="{y1}" x2="{x + tick / 2}" y2="{y1}"/>'
            f'<line x1="{x - tick / 2}" y1="{y2}" x2="{x + tick / 2}" y2="{y2}"/>'
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" marker-start="url(#ar2)" marker-end="url(#ar)"/></g>'
            f'<text x="{x - 10}" y="{cy}" font-size="17" fill="#1f5136" text-anchor="middle" '
            f'transform="rotate(-90 {x - 10} {cy})">{label}</text>')


def title_block(w, h, name, extra=""):
    bx, by, bw, bh = w - 384, h - 120, 360, 94
    return (f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="#ffffff" stroke="#2f6f4f" stroke-width="1.6"/>'
            f'<line x1="{bx}" y1="{by + 31}" x2="{bx + bw}" y2="{by + 31}" stroke="#2f6f4f" stroke-width="1"/>'
            f'<line x1="{bx}" y1="{by + 62}" x2="{bx + bw}" y2="{by + 62}" stroke="#2f6f4f" stroke-width="1"/>'
            f'<line x1="{bx + 216}" y1="{by + 31}" x2="{bx + 216}" y2="{by + bh}" stroke="#2f6f4f" stroke-width="1"/>'
            f'<text x="{bx + 10}" y="{by + 21}" font-size="15" font-weight="bold" fill="#241a12">{name}</text>'
            f'<text x="{bx + 10}" y="{by + 52}" font-size="13" fill="#241a12">Тёплый Контур — демо-чертёж</text>'
            f'<text x="{bx + 10}" y="{by + 83}" font-size="13" fill="#241a12">{extra}</text>'
            f'<text x="{bx + 226}" y="{by + 52}" font-size="13" fill="#241a12">Масштаб 1:50</text>'
            f'<text x="{bx + 226}" y="{by + 83}" font-size="13" fill="#241a12">03.10.2026</text>')


def wrap_drawing(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="Arial, sans-serif">{DRAW_DEFS}{body}</svg>')


def plan(slug, L, W, H):
    w, h = 900, 640
    s = min(74, 420 / max(L, 1), 300 / max(W, 1))
    bw, bh = L * s, W * s
    x, y = (w - bw) / 2, (h - bh) / 2 - 24
    o = [sheet(w, h)]
    o.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" fill="#fffdf8" stroke="#241a12" stroke-width="3"/>')
    o.append(f'<rect x="{x + 13}" y="{y + 13}" width="{bw - 26}" height="{bh - 26}" fill="none" stroke="#8a7a68" stroke-width="1.4"/>')
    gx = x + 13
    while gx < x + bw - 13:
        o.append(f'<line x1="{gx:.0f}" y1="{y + 13}" x2="{gx:.0f}" y2="{y + bh - 13}" stroke="#ded1bf" stroke-width="1" stroke-dasharray="3 5"/>')
        gx += 48
    nwin = max(1, int(L // 3))
    for i in range(nwin):
        wx = x + bw * (i + 0.5) / nwin - 30
        o.append(f'<rect x="{wx:.0f}" y="{y - 4}" width="60" height="8" fill="#b9d2e0" stroke="#241a12" stroke-width="1.6"/>')
        o.append(f'<rect x="{wx:.0f}" y="{y + bh - 4}" width="60" height="8" fill="#b9d2e0" stroke="#241a12" stroke-width="1.6"/>')
    dw = 62
    dx = x + bw - dw - 22
    o.append(f'<line x1="{dx:.0f}" y1="{y + bh}" x2="{dx:.0f}" y2="{y + bh + 58}" stroke="#241a12" stroke-width="1.6" stroke-dasharray="5 4"/>')
    o.append(f'<path d="M{dx:.0f} {y + bh} A58 58 0 0 1 {dx + 58:.0f} {y + bh + 58}" fill="none" stroke="#8a7a68" stroke-width="1.4"/>')
    o.append(f'<text x="{dx + 70:.0f}" y="{y + bh + 50}" font-size="13" fill="#5b4a3a">870 мм</text>')
    o.append(dim_h(x, x + bw, y - 26, f"{L:g} м"))
    o.append(dim_v(y, y + bh, x - 26, f"{W:g} м"))
    o.append(f'<text x="{x + bw / 2:.0f}" y="{y + bh / 2 + 8:.0f}" font-size="26" fill="#8a7a68" text-anchor="middle" opacity="0.5">{L:g} × {W:g} м</text>')
    o.append(title_block(w, h, f"План-кровля {L:g}×{W:g} м", f"Высота в целом {H:g} м · площадь {L * W:.1f} м²"))
    return wrap_drawing(w, h, "".join(o))


def section_drawing(slug, L, W, H):
    w, h = 900, 640
    bw = min(L * 74, 560)
    bh = H * 74
    x = 190
    y = h - 170 - bh
    base = y + bh
    o = [sheet(w, h)]
    o.append(f'<rect x="0" y="{base}" width="{w}" height="{h - base}" fill="#eef2e6"/>')
    o.append(f'<line x1="{x - 40}" y1="{base}" x2="{x + bw + 60}" y2="{base}" stroke="#8a7a68" stroke-width="2"/>')
    o.append(f'<rect x="{x + 18}" y="{base}" width="26" height="32" fill="#b9ab93" stroke="#241a12" stroke-width="1.4"/>')
    o.append(f'<rect x="{x + bw - 44}" y="{base}" width="26" height="32" fill="#b9ab93" stroke="#241a12" stroke-width="1.4"/>')
    o.append(f'<rect x="{x}" y="{base - 28}" width="{bw}" height="9" fill="#c9a06a" stroke="#241a12" stroke-width="1.2"/>')
    o.append(f'<rect x="{x}" y="{base - 19}" width="{bw}" height="11" fill="#f2d98a" stroke="#241a12" stroke-width="1.2"/>')
    wall_h = bh * 0.6
    wt = base - 28 - wall_h
    o.append(f'<rect x="{x}" y="{wt}" width="16" height="{wall_h}" fill="#c9a06a" stroke="#241a12" stroke-width="1.4"/>')
    o.append(f'<rect x="{x + 16}" y="{wt}" width="26" height="{wall_h}" fill="#f2d98a" stroke="#241a12" stroke-width="1.2"/>')
    st = x + 42
    while st < x + bw - 26:
        o.append(f'<rect x="{st:.0f}" y="{wt}" width="12" height="{wall_h}" fill="#a97f4c" stroke="#241a12" stroke-width="1"/>')
        st += 46
    o.append(f'<rect x="{x + bw - 26}" y="{wt}" width="26" height="{wall_h}" fill="#e6d3b4" stroke="#241a12" stroke-width="1.4"/>')
    ridge = wt - 48
    o.append(f'<path d="M{x - 22} {wt} L{x + bw / 2:.0f} {ridge:.0f} L{x + bw + 22} {wt}" fill="none" stroke="#241a12" stroke-width="5"/>')
    o.append(f'<path d="M{x - 36} {wt - 15} L{x + bw / 2:.0f} {ridge - 21:.0f} L{x + bw + 36} {wt - 15}" fill="none" stroke="#5d4630" stroke-width="9"/>')
    o.append(f'<rect x="{x + bw / 2 - 6:.0f}" y="{ridge:.0f}" width="12" height="{wall_h + 48}" fill="#8a6236" opacity="0.45"/>')
    lx = x + bw + 74
    o.append(f'<g font-size="13" fill="#241a12">'
             f'<line x1="{x + bw + 6}" y1="{wt + wall_h * 0.42:.0f}" x2="{lx - 8}" y2="{wt + wall_h * 0.42:.0f}" stroke="#8a7a68" stroke-width="1"/>'
             f'<text x="{lx}" y="{wt + wall_h * 0.42 + 5:.0f}">обшивка</text>'
             f'<line x1="{x + bw + 6}" y1="{wt + wall_h * 0.16:.0f}" x2="{lx - 8}" y2="{wt + wall_h * 0.16:.0f}" stroke="#8a7a68" stroke-width="1"/>'
             f'<text x="{lx}" y="{wt + wall_h * 0.16 + 5:.0f}">утеплитель 100 мм</text>'
             f'<line x1="{x + 36}" y1="{base - 12}" x2="{x - 76}" y2="{base - 12}" stroke="#8a7a68" stroke-width="1"/>'
             f'<text x="{x - 82}" y="{base - 8}" text-anchor="end">пол 28 мм</text>'
             f'<line x1="{x + bw + 36}" y1="{ridge - 21:.0f}" x2="{lx - 8}" y2="{ridge - 21:.0f}" stroke="#8a7a68" stroke-width="1"/>'
             f'<text x="{lx}" y="{ridge - 17:.0f}">кровля, профнастил С8</text>'
             f'</g>')
    o.append(dim_v(y, base, x - 34, f"{H:g} м"))
    o.append(dim_h(x, x + bw, h - 120, f"{L:g} м"))
    o.append(title_block(w, h, f"Разрез {L:g}×{W:g}×{H:g} м", "Утепление 100 мм · пол 28 мм"))
    return wrap_drawing(w, h, "".join(o))

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
    # чертежи: план-кровля и разрез под каждое изделие с габаритами
    drawings = [
        ("bytovka-6x3", 6.0, 3.0, 2.7),
        ("bytovka-4x2", 4.0, 2.0, 2.5),
        ("bytovka-7x3-2", 7.0, 3.0, 2.8),
        ("hozhblok-3x2", 3.0, 2.0, 2.3),
        ("tualet-12", 1.2, 1.2, 2.2),
    ]
    for slug, L, W, H in drawings:
        write(f"plan-{slug}.svg", plan(slug, L, W, H))
        write(f"section-{slug}.svg", section_drawing(slug, L, W, H))

    # favicon
    write("favicon.svg", wrap(64, 64,
          '<rect width="64" height="64" rx="12" fill="#8a6236"/>'
          '<path d="M12 34 L32 18 L52 34 L52 50 L12 50 Z" fill="#f3ece0"/>'
          '<rect x="26" y="34" width="12" height="16" fill="#8a6236"/>'))


if __name__ == "__main__":
    main()