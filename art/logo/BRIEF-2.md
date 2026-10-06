# Logo brief 2: a hand of cards with the hill

The five proposals of the first brief (`BRIEF.md`, `logo-1.png` to `logo-5.png`) were not chosen:
the eyes look like surveillance, the glasses are too complicated, the magnifying glass looks like a property site,
and a lighthouse says little. The card as an object was the part that worked (`logo-3.png`).

This brief asks for three variants of one new idea. Read `BRIEF.md` first: its rules for size, palette, line and small sizes still apply.

## The idea

A hand of three collector cards, fanned out, as a player holds them. No human hand and no fingers: only the three cards.

- The front card is fully visible. It shows the hill of the game: a rounded green hill with a path that winds to the top,
  and a few trees. Use `../cards/hill.png` as the reference for this motif. Simplify it for a small icon:
  the hill and the winding path must read first, the trees are secondary.
- The path is the point of the logo: a way towards something to find in your own surroundings. Make the path clear and light against the green hill.
- The two cards behind it show only a part of themselves: an edge, a corner, a strip of colour. They do not show a full picture.
- Each card is a parchment card with rounded corners and the hand-drawn ink outline, as the card in `logo-3.png`.
- No text, no letters, no numbers, no suit symbols. These are not playing cards.

## Three variants

1. `logo-6.png`: the fan stands upright and symmetric on a deep green background (`#16302b`). The hill card is in the middle, in front.
2. `logo-7.png`: the fan leans to one side on a deep green background. The hill card is the front card at one end, and it is larger than in variant 1.
3. `logo-8.png`: a close view. The hill card fills most of the square, slightly tilted, and the two other cards show behind it as two corners.
   Choose the background that gives the best contrast.

The three variants must differ in composition, as described. The fan as a whole stays inside the central 80 percent of the square.

## Small sizes

At 32 x 32 pixels a viewer must still see: cards, and a hill with a path. Check this on the sheet. If the hill becomes a green blob at 32 pixels,
make the path wider and lighter, remove trees, and make the variant again.

## Deliverables

Write files only under `art/logo/`. Do not change any other file.

1. `logo-6.png`, `logo-7.png`, `logo-8.png`: 1024 x 1024, RGB, opaque, treated as the first five (spot colours, no dithering).
2. `logos-check-2.png`: a sheet as `logos-check.png`, with the three new variants and `logo-3.png` for comparison:
   each at 512, 192, 64 and 32 pixels, and at 192 pixels inside a circle mask and a rounded square mask.
3. Add the three final prompts to `prompts.json`.
4. Add a section "Second round" to `README.md`: one paragraph for each variant, and your ranking of the three with the reason.

Use the built-in image generation tool. Open each result and the check sheet before you finish.
