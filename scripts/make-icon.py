#!/usr/bin/env python3
"""Generate the macOS app icon (build/icon.icns) from code.

Design: the product itself — a paper-white Big Sur squircle holding the app's
actual node language: an ink root node branching right through soft bezier
edges into three tag-colored children (teal / primary blue / orange).
Colors come from src/styles.css tokens. Re-run after palette changes:

    python3 scripts/make-icon.py
"""

import math
import os
import shutil
import subprocess

from PIL import Image, ImageDraw

S = 4  # supersample factor (draw at 4096, ship 1024)
CANVAS = 1024 * S

# ── tokens (src/styles.css) ──────────────────────────────────────────────────
INK = "#31302e"
PRIMARY = "#0075de"
TEAL = "#459b92"
ORANGE = "#d9854a"
EDGE = "#b3ada4"
PAPER_TOP = (255, 255, 255)
PAPER_BOTTOM = (243, 241, 237)


def superellipse(cx, cy, r, n=4.6, steps=720):
    """Apple-ish squircle outline points."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = cx + r * (abs(c) ** (2 / n)) * (1 if c >= 0 else -1)
        y = cy + r * (abs(s) ** (2 / n)) * (1 if s >= 0 else -1)
        pts.append((x, y))
    return pts


def bezier(p0, c1, c2, p1, steps=64):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * c1[0] + 3 * u * t**2 * c2[0] + t**3 * p1[0]
        y = u**3 * p0[1] + 3 * u**2 * t * c1[1] + 3 * u * t**2 * c2[1] + t**3 * p1[1]
        pts.append((x, y))
    return pts


def render(dev: bool) -> Image.Image:
    """The release icon, or the dev variant (inverted: dark slate, light root)."""
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    # squircle mask (Big Sur grid: 824/1024, centered)
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).polygon(superellipse(512 * S, 512 * S, 412 * S), fill=255)

    # subtle vertical gradient — warm paper, or dark slate for the dev build
    top, bottom = ((47, 46, 44), (31, 31, 31)) if dev else (PAPER_TOP, PAPER_BOTTOM)
    grad = Image.new("RGBA", (CANVAS, CANVAS))
    gd = ImageDraw.Draw(grad)
    for y in range(CANVAS):
        t = y / CANVAS
        col = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        gd.line([(0, y), (CANVAS, y)], fill=col + (255,))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # ── glyph (coords in 1024 space, ×S when drawn) ──────────────────────────
    root = (208, 432, 424, 592)  # ink root node
    kids = [
        ((614, 238, 818, 366), TEAL),
        ((614, 448, 818, 576), PRIMARY),
        ((614, 658, 818, 786), ORANGE),
    ]

    # edges first (under the nodes), app-style horizontal beziers
    rx, ry = root[2], (root[1] + root[3]) / 2
    for (x0, y0, x1, y1), _c in kids:
        cy = (y0 + y1) / 2
        # leave the root horizontally, arrive at the child horizontally
        pts = bezier((rx - 8, ry), (rx + 96, ry), (x0 - 96, cy), (x0 + 8, cy))
        d.line(
            [(x * S, y * S) for x, y in pts],
            fill=EDGE,
            width=26 * S,
            joint="curve",
        )

    def node(box, fill, radius):
        x0, y0, x1, y1 = (v * S for v in box)
        d.rounded_rectangle((x0, y0, x1, y1), radius=radius * S, fill=fill)

    node(root, PAPER_TOP if dev else INK, 54)
    for box, color in kids:
        node(box, color, 44)

    return img.resize((1024, 1024), Image.LANCZOS)


def write_icns(img: Image.Image, out_dir: str, stem: str) -> None:
    img.save(os.path.join(out_dir, f"{stem}.png"))
    iconset = os.path.join(out_dir, f"{stem}.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        img.resize((size, size), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}.png")
        )
        img.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}@2x.png")
        )
    subprocess.run(
        ["iconutil", "-c", "icns", iconset, "-o", os.path.join(out_dir, f"{stem}.icns")],
        check=True,
    )


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "build")
    os.makedirs(out_dir, exist_ok=True)
    write_icns(render(dev=False), out_dir, "icon")
    write_icns(render(dev=True), out_dir, "icon-dev")
    print("wrote build/icon.{png,icns} + build/icon-dev.{png,icns}")


if __name__ == "__main__":
    main()
