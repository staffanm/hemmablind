# Art brief: Landmark Cards card images

Landmark Cards is a location game for phones. Each bench, lighthouse, runestone and bus stop in OpenStreetMap is a card.
The player walks to the real place, photographs it and gets the card. The game is Swedish and the places are in Sweden.

Today a card shows a small one-colour map icon (see `reference/card-current.png`).
This brief asks for one illustration for each card type: 93 images in one consistent style.
The map keeps the icons. The card shows the illustration, so the illustration must read as the same thing as the icon.

## Style

Hand-drawn, flat colours, slightly exaggerated. Think of a modern illustrated field guide or a set of collector stickers.

- **Build on the icon.** `reference/icons/<key>.png` is the map icon of each card. Keep its viewpoint, its main silhouette and
  its composition. A player who knows the icon must recognise the illustration at once. Then add what the icon cannot show:
  material, construction, real proportions and a few true details.
- **Hand-drawn line.** A dark warm ink outline (`#4a3b22`), drawn by hand: slightly uneven, a little thicker on the outside
  contour than on the inside details. No ruler-straight vector lines.
- **Flat colour.** Each area has one flat colour, plus at most one flat shadow tone. No gradients, no airbrush, no photo texture,
  no glossy 3D render, no drop shadow.
- **Slight exaggeration.** Chunky, friendly proportions. Make the feature that identifies the thing a little too large:
  the lantern of the lighthouse, the slats of the bench, the wheel of the watermill. Not a caricature and not cute: no faces on objects.
- **One palette for all 93 images**, from the map of the game: parchment `#efe6cd`, forest green `#afd08a`, grass green `#cfe3a2`,
  water blue `#79c7d8`, building tan `#dcc9a1`, path brown `#a0673a`, deep green `#16302b`, gold `#e8b021`.
  Add falu red `#9c3b2a`, granite grey `#9a9a94` and off-white `#f7f3e6`. Use other colours only where the subject needs them
  (the yellow of a Swedish post box).
- **A small piece of ground.** The subject stands on a small flat patch of its surroundings (grass, rock, gravel, water),
  with an irregular hand-drawn edge. No full scene, no sky, no horizon, no frame.
- **Swedish.** Where `reference/types.json` names a Swedish form (vindskydd, fäbod, kolmila, tjärdal, midsommarstång,
  stubbkvarn, falu red cabins), draw that form.
- **No text.** No letters, digits or legible writing. Signs and plaques carry marks that look like writing but say nothing.
  The rune stone is the one exception: see below.
- **No people.** Animals only where the subject needs one (the dog park, the fish ladder).

## How the game shows an image

The card shows the image at about 180 x 180 CSS pixels on a parchment panel (`#efe6cd`) with rounded corners.
The image must read clearly at 96 x 96 pixels: big shapes and strong contrast first, detail second.

## Subjects

`reference/types.json` lists the 93 images. Each entry has:

- `key`: the file name of the image
- `icon`: the icon that it builds on (`reference/icons/<key>.png` is that icon)
- `name_sv`: the Swedish name of the card type
- `osm`: the OpenStreetMap tag
- `subject`: what to draw

`reference/icons-sheet.png` shows all icons with their keys.
Four keys (`church`, `mosque`, `synagogue`, `temple`) are variants of `place_of_worship` and share its icon. They must differ clearly from each other.

## The rune stone

The `rune_stone` image carries a real inscription. This overrides the "no text" rule for this one image.

- The serpent band follows the edge of the stone, as on a Swedish rune stone from the 11th century.
  The serpent ends in a head that a player recognises as a head: seen from the side, with an eye and an open jaw.
- The band holds these Younger Futhark runes, in red, in this order, with a two-dot divider between the words:

  `ᛘᛅᚾ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ : ᛘᛅᚾ : ᛘᚢᛋᛏᛁ : ᚢᛅᚾᛁᛅ : ᛋᛁᚴ`

- The inscription starts at the head of the serpent. Each rune must have its correct shape. No rune is missing, added or changed.
- Compare the result with the sequence, rune by rune. An image tool often draws runes that only look right.
  If the tool does not give the exact sequence, generate the stone with an empty band and draw the runes in `scripts/build.py`
  from line strokes along the band, in the same hand-drawn line as the rest. This machine has no runic font.
- The runes must still read at 180 x 180 pixels, so the band is wide and the stone fills the image.

## Deliverables

Write all files under `art/`. Do not change any file outside `art/`.

1. `cards/<key>.png` for each of the 93 keys: 1024 x 1024, RGBA, **transparent background**.
   The subject and its ground patch are centred and fill 75 to 90 percent of the width or the height. No part touches the edge.
   The outline is clean against transparency: no halo, no leftover background colour.
2. `cards-check.png`: one sheet with all 93 images on the parchment colour, each at 180 x 180 with its key below it.
3. `cards-small-check.png`: the same sheet with each image at 96 x 96.
4. `style-check.png`: the pilot images from step 1 below, each beside its icon.
5. `scripts/prompts.json`: the complete final prompt of each image, with its key.
6. `scripts/build.py`: the deterministic steps after generation (background removal if you need it, trim, centre, resize, the check sheets).
7. `scripts/validate.py` and `scripts/validation.json`: the audit below, with its measured results.
8. `sources/`: the generated originals.
9. `README.md`: how the art was made and how to rebuild it.

## Process

1. **Pilot.** Make six images first: `bench`, `lighthouse`, `rune_stone`, `bus_stop`, `waterfall`, `church`.
   Put them beside their icons in `style-check.png` and open the sheet. Check each rule in the Style section.
   Change the style prompt until the six images look like one set, drawn by one hand.
2. **Fix the style text.** Write one style paragraph and use it word for word in each of the 93 prompts.
   Only the subject sentence changes. Use the pilot images as style references if the image tool accepts reference images.
3. **Make all 93.** Open each result. Make an image again if it breaks a style rule, shows text or people,
   differs from the icon in viewpoint or silhouette, or shows the wrong thing.
4. **Check the set.** Open `cards-check.png` and `cards-small-check.png`. Look for images that stand out:
   another line weight, another palette, gradients, a full scene in place of a ground patch, a subject that is too small.
   Make those again. Repeat until the sheet looks like one set.

## Audit

`scripts/validate.py` must check, for each of the 93 keys:

- the file exists, is 1024 x 1024 and RGBA;
- the four corner pixels are fully transparent;
- between 25 and 75 percent of the pixels are opaque;
- the bounding box of the opaque pixels has a margin of at least 16 px on each side and spans at least 75 percent of the width or the height;
- no pixel is half-transparent except in a band of 3 px along the outline.

The work is done when the audit passes for all 93 images and you have opened and inspected both check sheets after the last change.
State in `README.md` which images you made more than once and why.
