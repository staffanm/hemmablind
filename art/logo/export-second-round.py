"""Export built-in imagegen drawings using the brief's spot-color treatment."""
from pathlib import Path
import json
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SPOTS = [(22, 48, 43), (239, 230, 205), (175, 208, 138), (74, 59, 34)]
BG = SPOTS[0]
PALETTE = Image.new("P", (1, 1))
PALETTE.putpalette([channel for rgb in SPOTS + [SPOTS[-1]] * 252 for channel in rgb])
RESAMPLE = Image.Resampling.LANCZOS

def export(number):
    source = Image.open(ROOT / "sources" / f"logo-{number}-refined.png").convert("RGB")
    # Fixed palette, no dithering: remove generated shading without redrawing.
    flat = source.quantize(palette=PALETTE, dither=Image.Dither.NONE).convert("RGB")
    bounds = ImageChops.difference(flat, Image.new("RGB", flat.size, BG)).getbbox()
    if bounds is None:
        raise ValueError("Missing motif")
    motif = flat.crop(bounds)
    longest = 780 if number == 8 else 740
    scale = longest / max(motif.size)
    size = tuple(round(edge * scale) for edge in motif.size)
    motif = motif.resize(size, RESAMPLE)
    final = Image.new("RGB", (1024, 1024), BG)
    final.paste(motif, ((1024 - size[0]) // 2, (1024 - size[1]) // 2))
    final.save(ROOT / f"logo-{number}.png")
    bounds = ImageChops.difference(final, Image.new("RGB", final.size, BG)).getbbox()
    assert bounds and all(103 <= v <= 921 for v in bounds), bounds
    # Exact spot colors fill interiors; interpolation occurs only on boundaries.
    margin = final.crop((0, 0, 100, 1024))
    assert margin.getextrema() == tuple((v, v) for v in BG)
    print(f"logo-{number}.png: RGB 1024x1024; motif bounds {bounds}")
    return final

def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(name, size)

def crop_mask(icon, kind):
    enlarged = Image.new("L", (768, 768))
    draw = ImageDraw.Draw(enlarged)
    if kind == "circle":
        draw.ellipse((0, 0, 767, 767), fill=255)
    else:
        draw.rounded_rectangle((0, 0, 767, 767), radius=192, fill=255)
    return enlarged.resize((192, 192), RESAMPLE)

def sheet(icons):
    page = Image.new("RGB", (1584, 2408), (248, 246, 240))
    draw = ImageDraw.Draw(page)
    ink = SPOTS[-1]
    draw.text((32, 22), "Hemmablind — second round: cards and the hill", font=font(30, True), fill=ink)
    draw.text((32, 66), "Native pixel sizes • circle and rounded square: crop only, no extra padding", font=font(21), fill=ink)
    for row, number in enumerate((6, 7, 8, 3)):
        top = 132 + row * 572
        label = str(number)
        draw.text((24, top + 242), label, font=font(34, True), fill=ink)
        if number == 3:
            draw.text((88, top + 516), "First-round collector card — comparison", font=font(20), fill=ink)
        for x, size in ((88, 512), (640, 192), (880, 64), (992, 32)):
            draw.text((x, top - 29), f"{size} px", font=font(21), fill=ink)
            reduced = icons[number].resize((size, size), RESAMPLE)
            page.paste(reduced, (x, top + (512 - size) // 2))
        for x, kind, label in ((1080, "circle", "Circle · 192 px"), (1312, "rounded", "Rounded · 192 px")):
            draw.text((x, top - 29), label, font=font(21), fill=ink)
            reduced = icons[number].resize((192, 192), RESAMPLE)
            page.paste(reduced, (x, top + 160), crop_mask(reduced, kind))
    page.save(ROOT / "logos-check-2.png")
    # A loupe for inspection; actual-size samples remain on the required sheet.
    loupe = Image.new("RGB", (1140, 442), (248, 246, 240))
    draw = ImageDraw.Draw(loupe)
    draw.text((20, 12), "32 px at 8× nearest-neighbor zoom • native samples on logos-check-2.png", font=font(22), fill=ink)
    for col, number in enumerate((6, 7, 8, 3)):
        x = 20 + col * 280
        draw.text((x, 52), f"Logo {number}", font=font(24, True), fill=ink)
        small = icons[number].resize((32, 32), RESAMPLE)
        loupe.paste(small.resize((256, 256), Image.Resampling.NEAREST), (x, 92))
        loupe.paste(small, (x + 112, 376))
    loupe.save(ROOT / "small-sizes-check-2.png")

def prompts():
    target = ROOT / "prompts.json"
    existing = json.loads(target.read_text())
    additions = json.loads((ROOT / "second-round-prompts.json").read_text())
    existing["proposals"] = [p for p in existing["proposals"] if p["number"] not in (6, 7, 8)] + additions
    existing["export_second_round"] = {
        "format": "PNG", "size": [1024, 1024], "mode": "RGB",
        "palette": "Deep green, parchment, forest green and warm ink; no dithering; antialiasing only at shape edges.",
        "layout": "Preserve generated shapes, center motif, longest edge 740 px for 6 and 7; 780 px for close view 8.",
        "note": "Built-in generation and a built-in refinement per variant. Fixed-palette export removes residual source shading as required by the brief.",
        "script": "export-second-round.py",
        "check_sheet": "logos-check-2.png",
        "inspection_loupe": "small-sizes-check-2.png"
    }
    target.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")

if __name__ == "__main__":
    icons = {n: export(n) for n in (6, 7, 8)}
    icons[3] = Image.open(ROOT / "logo-3.png").convert("RGB")
    sheet(icons)
    prompts()

