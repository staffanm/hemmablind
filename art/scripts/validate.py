"""Measure all brief requirements independently of build.py; Pillow only."""
import json
import hashlib
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, __version__ as PILLOW_VERSION

ROOT=Path(__file__).resolve().parents[1]
INKS={'4a3b22','efe6cd','afd08a','cfe3a2','79c7d8','dcc9a1',
      'a0673a','16302b','e8b021','9c3b2a','9a9a94','f7f3e6'}

def audit_inscription():
    expected='ᛘᛅᚾ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ : ᛘᛅᚾ : ᛘᚢᛋᛏᛁ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ'
    path=ROOT/'scripts/rune-strokes.json'
    if not path.exists():
        return {'passed':False,'reason':'Missing deterministic stroke record'}
    record=json.loads(path.read_text())
    glyphs=record['glyphs']
    mask=Image.new('L',(1024,1024)); draw=ImageDraw.Draw(mask)
    for glyph in glyphs:
        for stroke in glyph['strokes']:
            draw.line([tuple(p) for p in stroke],fill=255,width=6,joint='curve')
            for x,y in stroke:
                draw.ellipse((x-2,y-2,x+2,y+2),fill=255)
        for x,y in glyph['dots']:
            draw.ellipse((x-3,y-3,x+3,y+3),fill=255)
    im=Image.open(ROOT/'cards/rune_stone.png').convert('RGBA')
    red=Image.new('L',im.size)
    red.putdata([255 if rgba==(156,59,42,255) else 0 for rgba in im.get_flattened_data()])
    checks={
        'exact_text':record['text']==expected,
        'exact_order':''.join(g['character'] for g in glyphs)==expected.replace(' ',''),
        'rune_count':sum(g['character']!=':' for g in glyphs)==27,
        'six_two_dot_dividers':sum(g['character']==':' and len(g['dots'])==2 for g in glyphs)==6,
        'source_matches':record['source_sha256']==hashlib.sha256((ROOT/'sources/rune_stone.png').read_bytes()).hexdigest(),
        'all_strokes_present_no_added_red_marks':ImageChops.difference(mask,red).getbbox() is None,
    }
    return {'passed':all(checks.values()),'checks':checks,'text':expected,
            'rune_count':27,'divider_count':6,'red_stroke_pixels':mask.histogram()[255],
            'glyphs':[{'index':g['index'],'character':g['character'],'codepoint':g['codepoint']} for g in glyphs]}

def shifted(image, dx, dy):
    out=Image.new('L',image.size)
    out.paste(image,(dx,dy))
    return out

def audit(key):
    path=ROOT/'cards'/(key+'.png')
    result={'key':key,'exists':path.exists()}
    if not path.exists():
        result['passed']=False
        return result
    with Image.open(path) as im:
        result.update(size=list(im.size),mode=im.mode)
        a=im.convert('RGBA').getchannel('A')
        histogram=a.histogram()
        count=im.width*im.height
        visible_box=a.getbbox()
        box=a.point(lambda n:255 if n==255 else 0).getbbox()
        result['corner_alpha']=[a.getpixel(p) for p in [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)]]
        result['opaque_pixels']=histogram[255]
        result['opaque_fraction']=histogram[255]/count
        result['nonzero_fraction']=(count-histogram[0])/count
        result['bounding_box']=list(box) if box else None
        result['nonzero_bounding_box']=list(visible_box) if visible_box else None
        result['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        colours=im.convert('RGBA').getcolors(4096)
        visible_colours=sorted({bytes(rgba[:3]).hex() for _,rgba in colours if rgba[3]>0}) if colours else []
        result['visible_ink_colours']=visible_colours
        result['shared_palette_only']=colours is not None and set(visible_colours)<=INKS
        result['margins']=[box[0],box[1],im.width-box[2],im.height-box[3]] if box else [0]*4
        result['span_fraction']=max((box[2]-box[0])/im.width,(box[3]-box[1])/im.height) if box else 0
        half=a.point(lambda n:255 if 0<n<255 else 0)
        core=a.point(lambda n:255 if n>=128 else 0)
        # A 3px Euclidean disk across the thresholded outline. A fractional
        # pixel is allowed only if the disk encounters both sides of it.
        low,high=core.copy(),core.copy()
        for dy in range(-3,4):
            for dx in range(-3,4):
                if dx*dx+dy*dy<=9:
                    other=shifted(core,dx,dy)
                    low=ImageChops.darker(low,other)
                    high=ImageChops.lighter(high,other)
        band=ImageChops.subtract(high,low)
        bad=ImageChops.subtract(half,band)
        result['half_transparent_pixels']=sum(half.histogram()[1:])
        result['half_transparent_outside_3px_band']=sum(bad.histogram()[1:])
        visible_margin=min(visible_box[0],visible_box[1],im.width-visible_box[2],im.height-visible_box[3]) if visible_box else 0
        checks={'png':im.format=='PNG','size':im.size==(1024,1024),'rgba':im.mode=='RGBA','transparent_corners':not any(result['corner_alpha']),'opaque_coverage':.25<=result['opaque_fraction']<=.75,'minimum_margin':min(result['margins'])>=16 and visible_margin>=16,'minimum_span':result['span_fraction']>=.75,'alpha_edge_band':result['half_transparent_outside_3px_band']==0}
        result['checks']=checks
        result['checks']['maximum_span']=result['span_fraction']<=.90
        result['checks']['shared_palette']=result['shared_palette_only']
        result['passed']=all(checks.values())
        return result

def main():
    types=json.loads((ROOT/'reference/types.json').read_text())
    results=[audit(t['key']) for t in types]
    passed=sum(r['passed'] for r in results)
    expected={t['key']+'.png' for t in types}
    unexpected=sorted(p.name for p in (ROOT/'cards').glob('*.png') if p.name not in expected)
    inscription=audit_inscription()
    report={'schema_version':1,'pillow_version':PILLOW_VERSION,'expected_count':93,'actual_count':sum(r['exists'] for r in results),'passed_count':passed,'unexpected_files':unexpected,'all_passed':len(results)==93 and passed==93 and not unexpected and inscription['passed'],'rune_inscription':inscription,'alpha_band_definition':'Euclidean radius 3 around the alpha >=128 silhouette boundary; opaque means alpha=255. Bounding box uses alpha=255; minimum margins also check every nonzero-alpha pixel.','images':results}
    (ROOT/'scripts/validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'{passed}/{len(results)} pass')
    print('Rune inscription:', 'pass' if inscription['passed'] else inscription)
    for r in results:
        if not r['passed'] and r['exists']:
            print(r['key'],{k:v for k,v in r['checks'].items() if not v},r['opaque_fraction'])
    raise SystemExit(0 if report['all_passed'] else 1)

if __name__=='__main__':
    main()
