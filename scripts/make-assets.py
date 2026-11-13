"""Genera iconos y pantallas de bienvenida (splash) a partir de public/img/foto.jpg.
Requiere Pillow:  pip install pillow   y luego   python3 scripts/make-assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(__file__)
PUB = os.path.join(HERE, '..', 'public')
ICONS = os.path.join(PUB, 'icons')
SPLASH = os.path.join(PUB, 'splash')
os.makedirs(ICONS, exist_ok=True)
os.makedirs(SPLASH, exist_ok=True)

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

# ── Splash de iOS (apple-touch-startup-image) ───────────────────────────
# (ancho lógico, alto lógico, ratio) → se genera ancho*ratio × alto*ratio
DEVICES = [
    (440, 956, 3), (402, 874, 3), (430, 932, 3), (393, 852, 3), (390, 844, 3),
    (428, 926, 3), (414, 896, 3), (375, 812, 3), (414, 896, 2), (375, 667, 2),
]
for lw, lh, r in DEVICES:
    w, h = lw * r, lh * r
    img = gradient(w, h).convert('RGBA')
    side = int(w * 0.6)
    logo = rounded(photo.resize((side, side), Image.LANCZOS), side // 7)
    x, y = (w - side) // 2, int(h * 0.5 - side * 0.62)
    # sombra suave
    sh = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + side // 25, x + side, y + side + side // 25), side // 7, fill=(30, 0, 60, 110))
    img = Image.alpha_composite(img, sh)
    img.alpha_composite(logo, (x, y))
    d = ImageDraw.Draw(img)
    for i, (txt, sz) in enumerate((('RACHA', int(w * 0.13)), ('OBLIGATORIA', int(w * 0.095)))):
        f = font(sz)
        tw = d.textlength(txt, font=f)
        d.text(((w - tw) / 2, y + side + int(h * 0.035) + i * int(w * 0.14)), txt, font=f, fill=(255, 255, 255))
    img.convert('RGB').save(os.path.join(SPLASH, f'splash-{w}x{h}.png'), optimize=True)
print('✔ splash iOS')
