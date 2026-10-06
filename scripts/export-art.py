# Copy the card illustrations in art/cards/ to the files the game loads from public/cards/.
# A 1024 pixel PNG master becomes a 512 pixel WebP with transparency, which is about a twentieth of the size.
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public/cards'
out.mkdir(parents=True, exist_ok=True)
total = 0
for src in sorted((root / 'art/cards').glob('*.png')):
    dst = out / f'{src.stem}.webp'
    Image.open(src).convert('RGBA').resize((512, 512), Image.LANCZOS).save(dst, quality=86, method=6)
    total += dst.stat().st_size
print(f'{len(list(out.glob("*.webp")))} images, {total // 1024} KB')
