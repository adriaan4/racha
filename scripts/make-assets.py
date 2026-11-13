"""Genera los iconos de la app a partir de public/img/foto.jpg.
Requiere Pillow:  pip install pillow   y luego   python3 scripts/make-assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(__file__)
PUB = os.path.join(HERE, '..', 'public')
ICONS = os.path.join(PUB, 'icons')
os.makedirs(ICONS, exist_ok=True)

photo = Image.open(os.path.join(PUB, 'img', 'foto.jpg')).convert('RGB')

PINK, PURPLE, RED = (255, 77, 141), (123, 47, 247), (255, 45, 61)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h):
    """Degradado diagonal rosa → morado → rojo."""
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            d = (x / w + y / h) / 2
            px[x, y] = mix(PINK, PURPLE, d * 2) if d < 0.5 else mix(PURPLE, RED, (d - 0.5) * 2)
    return img


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.size[0] - 1, img.size[1] - 1), radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def font(size):
    for p in ('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


# ── Iconos: la foto a pantalla completa ─────────────────────────────────
for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    photo.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))

# Maskable: la foto al 78 % sobre el degradado (zona segura para iconos adaptativos)
S = 512
mk = gradient(S, S)
inner = int(S * 0.78)
mk.paste(rounded(photo.resize((inner, inner), Image.LANCZOS), inner // 6), ((S - inner) // 2,) * 2,
         rounded(photo.resize((inner, inner), Image.LANCZOS), inner // 6))
mk.save(os.path.join(ICONS, 'icon-maskable-512.png'))
print('✔ iconos')
