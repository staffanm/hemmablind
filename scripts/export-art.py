# Copy the art masters in art/ to the files the game loads from public/.
# The logo becomes the app icons. A card illustration, a 1024 pixel PNG, becomes a 512 pixel WebP with transparency,
# which is about a twentieth of the size.
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public/cards'
out.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / 'art/logo/logo-7-mirror.png').convert('RGB')
for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)):
    logo.resize((size, size), Image.LANCZOS).save(root / 'public' / name, optimize=True)
# Android cuts a circle out of a maskable icon. The logo is 76 percent of this icon, on its own background colour,
# so that the three cards stay inside the safe circle (80 percent of the width).
maskable = Image.new('RGB', (512, 512), logo.getpixel((0, 0)))
maskable.paste(logo.resize((390, 390), Image.LANCZOS), (61, 61))
maskable.save(root / 'public/icon-maskable-512.png', optimize=True)

total = 0
for src in sorted((root / 'art/cards').glob('*.png')):
    dst = out / f'{src.stem}.webp'
    Image.open(src).convert('RGBA').resize((512, 512), Image.LANCZOS).save(dst, quality=86, method=6)
    total += dst.stat().st_size
print(f'{len(list(out.glob("*.webp")))} images, {total // 1024} KB')
