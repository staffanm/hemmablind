# Hemmablind illustrations

## Decisions and production record

All 96 subjects (the original 93 plus shop, restaurant and skateboard) come from `reference/types.json`. Images are made with the built-in image generation tool, one call per subject; no image API or generation CLI is used. The tool manages its own generated-image cache; originals are copied into `sources/`, and all project files and processing outputs stay under `art/`.

The six-image pilot is bench, lighthouse, rune_stone, bus_stop, waterfall and church. The icons are composition references, not artwork to recolour. When an abstract icon conflicts with the explicit subject or no-people rule (bus symbol, music notes, human exercise/swimming symbols), the supplied concrete subject takes priority, with frontal/side orientation and major composition retained where possible. Worship variants retain a frontal building composition but use their requested distinct architecture. The rune stone is the brief’s explicit text exception: the exact supplied Younger Futhark sequence is drawn in red from line strokes along a generated empty serpent band. Signs and clocks have pictograms and ticks only. The camera and legendary medallion have a minimal flat ground/support patch, rather than a fabricated full scene.

One fixed style paragraph is stored in `scripts/prompts.json` and repeated verbatim in every final prompt. The source icon is supplied as a composition reference; accepted pilot illustrations become style references for later images. Decisions are autonomous, as requested.

Some icon bands are symbolic rather than literal construction: the fjällstuga's jagged bands must not become stacked roofs. Detailed subject descriptions take priority in these cases. The fixed grill is a brick fire box despite the icon's wheeled kettle; the star-shaped fort is an earthwork despite the icon's medal; the viewing platform, swimming equipment and exercise bars replace abstract view/person symbols without depicting people. Roof direction and the viewpoint of concrete object icons are retained and corrected when generation reverses them. The jättegryta retains the icon’s cutaway cross-section so its round water-filled hollow and grinding stone are visible. The weir keeps higher upstream water on the left and lower downstream water on the right; its final view looks further down onto the compact patch to meet coverage without turning the low step into a tall waterfall.

## Rebuild

Generation is nondeterministic and requires the built-in image tool with the recorded prompts and references. `sources/` preserves the generated originals so rebuilding the final assets does not require generation.

From the repository root, run `python art/scripts/build.py` then `python art/scripts/validate.py`. Dependencies: Python and Pillow (the delivered build used Pillow 12.1.1). Processing normalises generated colours to the twelve specified inks without dithering (removing soft shading), cleans transparency, trims and centres the artwork, resizes to 1024 square, and builds the three check sheets. Validation records measured results for every key in `scripts/validation.json` and fails the process if any check fails. Labels appear on check sheets only, never in the card artwork.

The deterministic build thresholds source alpha at 128, closes pinholes with a five-pixel morphological closing, trims the nonzero bounds, and scales proportionally to a long edge between 880 and 916 pixels (85.9–89.5%). Narrow subjects receive the larger size, within the brief's limit. RGB fills receive a five-pixel median filter and hue-aware mapping to the shared inks; pale foliage uses one light grass ink to prevent threshold speckling; neutral metal stays grey, foliage stays green, and dark warm contours stay ink brown. Dithering is disabled. Interior alpha becomes 255 and background alpha becomes zero; Lanczos edge interpolation is retained only within two Chebyshev pixels of the silhouette, which is less than three Euclidean pixels. Fully transparent pixels have zero RGB. The only drawn content added by the script is the exact rune inscription, explicitly authorised in the brief; no ground or objects are added.

The sheets use the order in `reference/types.json`, nine columns, parchment backgrounds, and exact 180- or 96-pixel square image cells. The pilot pairs each accepted illustration with its actual icon, including the shared worship icon. Check-sheet labels use DejaVu Sans when available and Pillow's default font otherwise; use the same Pillow and font versions for identical sheet pixels. Individual card rebuilds do not depend on fonts. `build.py --keys KEY ...` can rebuild selected cards; it still refreshes all three sheets.

## Inspection and retries

Pilot sheet opened and reviewed after generation and again after the waterfall correction. The accepted pilot has frontal silhouettes, warm ink, flat shared colours, isolated ground, no people, and readable text only for the specified rune inscription, and recognisable small-scale shapes. All six pass the numerical audit.

Rejected originals remain in `sources/` with version suffixes. The regeneration record, including the three additions, is:

| Image | Generations | Reason for retry |
| --- | ---: | --- |
| bench | 2 | Soft tonal shading in wood and grass; tightened flat-fill style prompt. |
| shelter | 2 | Roof profile and viewpoint reversed relative to map icon; regenerate with left end lower and right end higher. |
| clock | 2 | Opaque coverage only 12.9%; dial too small and column too thin. |
| attraction | 2 | Correct frontal camera but the required ground patch was omitted. |
| alpine_hut | 2 | Literal zigzag bands from the icon became implausible stacked roof tiers instead of a Swedish fjällstuga. |
| lean_to | 2 | Roof profile and viewpoint reversed relative to map icon; regenerate with left end lower and right end higher. |
| rune_stone | 2 | Invented marks do not match the exact required Younger Futhark sequence. Regenerate an empty serpent band for deterministic strokes. |
| monument | 2 | Opaque coverage 23.1% even at maximum allowed size; broaden shaft and stepped base. |
| charcoal_pile | 2 | Pile looked like tiered timber walls rather than a Swedish earth-and-turf-covered charcoal dome. |
| city_gate | 2 | An unrequested church-style cross appeared on the gatehouse roof; keep the gateway secular and recognisable. |
| cliff | 2 | A large supposedly fallen slab was suspended in mid-air; every fallen rock must rest at the cliff foot. |
| chimney | 2 | Opaque coverage was only 21.53%; the narrow shaft and long diagonal smoke plume left too much empty space. |
| slipway | 2 | Opaque coverage 24.36%, just below the minimum; deepen ramp, water patch and boat hull while retaining the bow-up-left orientation. |
| waterfall | 3 | Outline too heavy compared with the other five pilot illustrations. Pen width improved but the three-stream and upper-right overhang composition was lost. |
| weir | 3 | Stone step became a tall waterfall, and two blue wave symbols floated in empty space; show a low weir with waves inside the connected water patch. Correct low weir and flow direction, but the long thin ground strip produced only 18.14% opaque coverage. Broaden the connected water patch in depth. |
| shop | 1 | Accepted on the first generation; no retry required. |
| restaurant | 2 | Soft source shading became mottled patches on the cafe facade after palette normalization. Regenerated with uniform off-white walls, opaque blue windows and simpler pavement; omitted the awning to distinguish it from the shop. |
| skateboard | 2 | Soft concrete shading collapsed to one grey fill during palette normalization, hiding the bowl hollow. Regenerated with a hard-edged deep-green inner wall, off-white bottom and grey rim. |

The final selected rebuild (`python art/scripts/build.py --keys shop restaurant skateboard`) and full audit (`python art/scripts/validate.py`) passed for **96/96 cards**. The validator derives the expected count from `reference/types.json`. Both complete check sheets were opened and inspected after the last card change, at their original resolution; the refreshed pilot was also opened. The 180-pixel sheet has consistent ink, flat colours and isolated ground patches. The 96-pixel sheet retains the identifying silhouettes, including the paired maypole wreaths, post-mill sails, salmon and stepped pools. No further image retries were required after these inspections. `scripts/inspection.json` records the inspected sheet hashes and all 96 keys.

Final measured opaque coverage is **25.03–48.76%**. The opaque bounding-box span is **85.84–89.45%**, and the smallest opaque margin is **54 px**. Every card is 1024 × 1024 RGBA PNG, all four corners have alpha zero, every fractional-alpha pixel falls within the three-pixel edge band, and visible RGB values use only the shared palette. The exact rune inscription also passes its independent pixel and sequence audit. There are no missing or unexpected card PNGs.

There are **115 generated originals**: 96 selected images and 19 retained rejected versions across the 17 repeated subjects listed above. Only the built-in image generation tool produced those originals. All final assets, scripts, prompts, audit records and this documentation are under `art/`.

PNG outputs are saved to temporary files beside their destinations and atomically replaced, so readers see complete images. An overlapping intermediate rebuild briefly attempted to read a PNG during replacement; both a subsequent full rebuild and the final sheet refresh/audit finished successfully. Run rebuilds sequentially using the commands above.

The first rune-stone pilot incorrectly used invented marks. It was rejected during the later brief review. The replacement has an empty band and a side-profile serpent head with an eye and open jaw. `build.py` draws exactly 27 runes and six two-dot dividers, starting beside the head, climbing the left band, crossing the top and descending the right. The eight distinct glyph shapes were checked against the [Unicode Runic chart](https://www.unicode.org/charts/PDF/U16A0.pdf), with original line-stroke constructions rather than a font. The full stone and a 180/96-pixel preview were opened; the sequence was compared word by word and rune by rune. `scripts/rune-strokes.json` records every glyph and stroke position. The audit checks the order, source hash, divider count and every red pixel, so extra or missing red marks fail.

The three added subjects use the fixed style paragraph verbatim, with their final prompts and references recorded in `scripts/prompts.json`. The shopping basket and fork-and-knife icons are abstract category symbols; as with the existing symbolic icons, their concrete subject descriptions take priority: frontal shop and cafe facades. The skatepark keeps the icon's broad horizontal composition and raised curved ends in a bowl, with the requested quarter pipe, rail and skateboard. The first restaurant and skateboard originals remain as `sources/restaurant-v1.png` and `sources/skateboard-v1.png`. Accepted originals are `sources/shop.png`, `sources/restaurant.png` and `sources/skateboard.png`; final cards are the corresponding files under `cards/`. The new originals and final cards were opened individually, then both complete check sheets and the pilot sheet were opened after the final rebuild. All 93 pre-existing card PNGs, their prompts and the fixed style paragraph are unchanged.
