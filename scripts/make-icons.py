"""Genera los iconos PNG de la app (llama con gafas de sol sobre degradado rosa/morado/rojo).
Solo usa la librería estándar de Python:  python3 scripts/make-icons.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


PINK, PURPLE, RED = (255, 77, 141), (123, 47, 247), (255, 45, 61)


def hw(t, k):
    """Semianchura de una forma de llama en t∈[0,1] (0 = punta, 1 = base)."""
    if t <= 0 or t >= 1:
        return 0
    return k * (t ** 0.75) * math.sqrt(max(0.0, 1 - t ** 4))


def color(u, v, scale):
    # fondo
    d = (u + v) / 2
    bg = mix(PINK, PURPLE, d * 2) if d < 0.5 else mix(PURPLE, RED, (d - 0.5) * 2)
    # llama (escalada respecto al centro)
    x = (u - 0.5) / scale
    y = (v - 0.5) / scale + 0.5
    top, bottom = 0.18, 0.84
    t = (y - top) / (bottom - top)
    if 0 < t < 1:
        wave = 0.035 * math.sin(t * 5.0) * (1 - t)
        fx = x - wave
        if abs(fx) < hw(t, 0.28):
            col = mix((255, 70, 40), (255, 150, 40), t)
            tt = (t - 0.32) / 0.68
            if 0 < tt < 1 and abs(fx) < hw(tt, 0.17):
                col = mix((255, 200, 60), (255, 240, 130), tt)
            # gafas de sol
            if 0.50 < y < 0.60:
                if (0.385 < u < 0.485 or 0.515 < u < 0.615) or (0.485 <= u <= 0.515 and y < 0.52):
                    col = (18, 12, 24)
            return col
    return bg


def render(size, scale, path):
    rows = []
    ss = 2
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    c = color((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, scale)
                    r += c[0]; g += c[1]; b += c[2]
            n = ss * ss
            row += bytes((int(r / n), int(g / n), int(b / n)))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('✔', os.path.basename(path))


render(192, 1.0, os.path.join(OUT, 'icon-192.png'))
render(512, 1.0, os.path.join(OUT, 'icon-512.png'))
render(180, 1.0, os.path.join(OUT, 'apple-touch-icon.png'))
render(512, 0.72, os.path.join(OUT, 'icon-maskable-512.png'))  # zona segura para iconos adaptativos
