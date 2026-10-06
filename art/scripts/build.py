"""Deterministically prepare built-in generated originals; Pillow only."""
import argparse
import json
import math
import colorsys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
PILOT = ['bench', 'lighthouse', 'rune_stone', 'bus_stop', 'waterfall', 'church']
PARCHMENT = '#efe6cd'
PALETTE = ['#4a3b22','#efe6cd','#afd08a','#cfe3a2','#79c7d8',
           '#dcc9a1','#a0673a','#16302b','#e8b021','#9c3b2a',
           '#9a9a94','#f7f3e6']

def save_png(image, path):
    # Readers must always see a complete PNG, even during a selected rebuild.
    with tempfile.NamedTemporaryFile(dir=path.parent,suffix='.tmp',delete=False) as tmp:
        temporary=Path(tmp.name)
    try:
        image.save(temporary,format='PNG')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)

RUNE_TEXT = 'ᛘᛅᚾ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ : ᛘᛅᚾ : ᛘᚢᛋᛏᛁ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ'
# Original line-stroke constructions checked against the Unicode Runic chart.
# Coordinates: x follows the inscription, y runs from outer to inner band edge.
RUNE_STROKES = {
    'ᛘ': [[(.5,0),(.5,1)], [(0,0),(.08,.20),(.25,.30),(.5,.34),(.75,.30),(.92,.20),(1,0)]],
    'ᛅ': [[(.5,0),(.5,1)], [(0,.66),(1,.34)]],
    'ᚾ': [[(.5,0),(.5,1)], [(0,.34),(1,.66)]],
    'ᚢ': [[(0,1),(0,0),(.45,.06),(.80,.27),(1,.55),(1,1)]],
    'ᛁ': [[(.5,0),(.5,1)]],
    'ᛋ': [[(0,0),(0,.65),(1,.35),(1,1)]],
    'ᚴ': [[(0,0),(0,1)], [(0,.48),(.60,.30),(1,0)]],
    'ᛏ': [[(.5,0),(.5,1)], [(0,.22),(.5,0),(1,.22)]],
}

def inscribe_runes(canvas):
    # Measured centreline of the generated empty serpent band, in final pixels.
    path = [(307,688),(330,620),(351,540),(367,450),(372,360),
            (378,300),(391,250),(414,208),(449,178),(491,156),
            (540,155),(584,166),(624,193),(653,230),(677,290),
            (690,360),(700,445),(706,530),(715,615),(727,690),(744,752)]
    lengths=[math.dist(a,b) for a,b in zip(path,path[1:])]
    total=sum(lengths)
    chars=RUNE_TEXT.replace(' ','')
    draw=ImageDraw.Draw(canvas)
    records=[]
    for n,char in enumerate(chars):
        distance=(n+.5)*total/len(chars)
        segment=0
        while distance>lengths[segment]:
            distance-=lengths[segment]; segment+=1
        a,b=path[segment],path[segment+1]
        ux,uy=(b[0]-a[0])/lengths[segment],(b[1]-a[1])/lengths[segment]
        cx,cy=a[0]+ux*distance,a[1]+uy*distance
        def point(x,y):
            return (round(cx+ux*(x-.5)*26-uy*(y-.5)*54),
                    round(cy+uy*(x-.5)*26+ux*(y-.5)*54))
        record={'index':n,'character':char,'codepoint':f'U+{ord(char):04X}',
                'centre':[cx,cy],'strokes':[],'dots':[]}
        if char==':':
            for y in [.34,.66]:
                x,y=point(.5,y)
                draw.ellipse((x-3,y-3,x+3,y+3),fill='#9c3b2a')
                record['dots'].append([x,y])
        else:
            for stroke in RUNE_STROKES[char]:
                points=[point(x,y) for x,y in stroke]
                draw.line(points,fill='#9c3b2a',width=6,joint='curve')
                for x,y in points:
                    draw.ellipse((x-2,y-2,x+2,y+2),fill='#9c3b2a')
                record['strokes'].append(points)
        records.append(record)
    (ROOT/'scripts/rune-strokes.json').write_text(json.dumps({
        'text':RUNE_TEXT,'rune_count':27,'word_dividers':6,
        'glyphs':records,'stroke_colour':'#9c3b2a','stroke_width':6,
        'reference':'https://www.unicode.org/charts/PDF/U16A0.pdf',
        'direction':'from serpent head, up left side, across top, down right side',
        'source_sha256':__import__('hashlib').sha256((ROOT/'sources/rune_stone.png').read_bytes()).hexdigest()
    },ensure_ascii=False,indent=2)+'\n')

def flat_palette(image):
    # Hue-aware mapping avoids treating muted green/neutral metal as brown.
    # A small median removes generation noise; no dithering or soft shading.
    indexed=image.convert('RGB').filter(ImageFilter.MedianFilter(5)).quantize(colors=256,dither=Image.Dither.NONE)
    old=indexed.getpalette()
    def ink(rgb):
        h,s,v=colorsys.rgb_to_hsv(*(n/255 for n in rgb))
        h*=360
        if v<.18: return '#16302b'
        if s<.19:
            if v>.89: return '#f7f3e6'
            return '#9a9a94' if v>.36 else '#16302b'
        if 65<h<170:
            if v<.42 or (h>135 and v<.70): return '#16302b'
            # A single light foliage ink avoids threshold mottling in grass.
            return '#cfe3a2'
        if 170<=h<285: return '#16302b' if v<.43 else '#79c7d8'
        if v<.47: return '#4a3b22'
        if s<.28 and v>.82:
            return '#efe6cd' if s<.19 else '#dcc9a1'
        if 38<h<=65 and s>.40: return '#e8b021'
        if h<19 or h>=285: return '#9c3b2a'
        return '#dcc9a1' if s<.45 and v>.68 else '#a0673a'
    new=[]
    for n in range(256):
        new.extend(bytes.fromhex(ink(old[n*3:n*3+3])[1:]))
    indexed.putpalette(new)
    return indexed.filter(ImageFilter.ModeFilter(3)).convert('RGB')

def prepare(key):
    image = Image.open(ROOT / 'sources' / (key + '.png')).convert('RGBA')
    # Generated alpha is preserved as a shape, with faint stray pixels removed.
    # Binary alpha before resampling guarantees that translucent interiors do
    # not survive. Antialias only at the final silhouette, with radius <= 3.
    alpha = image.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
    alpha = alpha.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    box = alpha.getbbox()
    if not box:
        raise ValueError(f'{key}: empty alpha')
    image.putalpha(alpha)
    image = image.crop(box)
    filled = alpha.histogram()[255]
    shape_ratio = filled / max(image.size)**2
    long_edge = max(880, min(916, math.ceil(1024 * math.sqrt(.28/shape_ratio))))
    scale = long_edge / max(image.size)
    size = tuple(max(1, round(n * scale)) for n in image.size)
    image = image.resize(size, Image.Resampling.LANCZOS)
    a = image.getchannel('A')
    image = flat_palette(image).convert('RGBA')
    core = a.point(lambda n: 255 if n >= 128 else 0)
    inner = core.filter(ImageFilter.MinFilter(5))
    outer = core.filter(ImageFilter.MaxFilter(5))
    # Keep interpolation only within two Chebyshev pixels of the boundary
    # (Euclidean distance <= sqrt(8) < 3). Clamp the remaining alpha.
    a = ImageChops.lighter(a, inner)
    a = ImageChops.darker(a, outer)
    image.putalpha(a)
    image.paste((0,0,0,0), mask=a.point(lambda n: 255 if n==0 else 0))
    canvas = Image.new('RGBA', (1024, 1024))
    canvas.paste(image, ((1024-size[0])//2, (1024-size[1])//2))
    if key=='rune_stone':
        inscribe_runes(canvas)
    save_png(canvas, ROOT / 'cards' / (key + '.png'))

def font(size):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default()

def sheet(types, side, filename):
    columns = 9
    padding, label = 16, 34
    cellw, cellh = side+padding*2, side+padding+label
    rows = math.ceil(len(types)/columns)
    canvas = Image.new('RGB', (columns*cellw, rows*cellh), PARCHMENT)
    draw = ImageDraw.Draw(canvas)
    for n, item in enumerate(types):
        x, y = (n%columns)*cellw, (n//columns)*cellh
        path = ROOT/'cards'/(item['key']+'.png')
        if not path.exists():
            continue
        card = Image.open(path).convert('RGBA').resize((side,side), Image.Resampling.LANCZOS)
        canvas.paste(card, (x+padding,y+8), card)
        label_size=13 if side==96 else 16
        while draw.textbbox((0,0),item['key'],font=font(label_size))[2]>cellw-8:
            label_size-=1
        draw.text((x+cellw//2,y+side+18),item['key'], fill='#4a3b22',font=font(label_size),anchor='mm')
    save_png(canvas, ROOT/filename)

def pilot_sheet(types):
    canvas = Image.new('RGB',(1008,720),PARCHMENT)
    draw = ImageDraw.Draw(canvas)
    bykey={t['key']:t for t in types}
    for n,key in enumerate(PILOT):
        x,y=(n%3)*336,(n//3)*360
        icon=Image.open(ROOT/'reference/icons'/(bykey[key]['icon']+'.png')).convert('RGBA')
        icon.thumbnail((100,100),Image.Resampling.LANCZOS)
        canvas.paste(icon,(x+14,y+115),icon)
        path=ROOT/'cards'/(key+'.png')
        if path.exists():
            card=Image.open(path).resize((216,216),Image.Resampling.LANCZOS)
            canvas.paste(card,(x+116,y+60),card)
        draw.text((x+168,y+310),key,fill='#4a3b22',font=font(19),anchor='mm')
    save_png(canvas, ROOT/'style-check.png')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--keys',nargs='*')
    args=parser.parse_args()
    types=json.loads((ROOT/'reference/types.json').read_text())
    for t in types:
        if (args.keys is None or t['key'] in args.keys) and (ROOT/'sources'/(t['key']+'.png')).exists():
            prepare(t['key'])
    sheet(types,180,'cards-check.png')
    sheet(types,96,'cards-small-check.png')
    pilot_sheet(types)

if __name__=='__main__':
    main()
