# Logo brief: Hemmablind

Hemmablind is a Swedish location game for phones. Each bench, lighthouse, rune stone and bus stop near the player is a card.
The player walks to the real place, photographs it and gets the card.

"Hemmablind" is a Swedish word for a person who no longer sees the place where they live, because it is too familiar.
The game is the cure: it makes you see your own neighbourhood again.

This brief asks for five distinct logo proposals for the app icon. One of them becomes the icon on the phone's home screen,
the browser tab icon and the picture on the start screen.

## What a proposal must be

- A square app icon, 1024 x 1024, with an opaque background that fills the whole square. No transparency, no rounded corners
  (the phone cuts the corners), no border, no drop shadow under the square.
- One simple motif that still reads at 32 x 32 pixels. The motif stays inside the central 80 percent of the square,
  because Android cuts a circle out of the icon.
- No text and no letters. The name is written beside the icon by the phone.
- The same hand as the card illustrations of the game: a hand-drawn dark warm ink outline (`#4a3b22`), flat colours,
  slightly exaggerated shapes. No gradients, no gloss, no 3D, no photo texture.
- The palette of the game: deep green `#16302b`, gold `#e8b021`, parchment `#efe6cd`, forest green `#afd08a`, water blue `#79c7d8`,
  falu red `#9c3b2a`. At most four colours plus the ink in one logo.

## Five distinct ideas

Make one proposal for each idea. The five must differ in motif, not only in colour.

1. **The eye that sees a place.** An open eye whose iris is a map pin, or whose pupil is a small landmark.
2. **The lifted blindfold.** A little red Swedish house that lifts a blindfold or opens one eye. "Hemma" means "at home".
3. **The card and the pin.** A collector card, slightly tilted, with a map pin or a small lighthouse on it.
4. **The glasses.** A pair of round glasses, and each lens shows a small place: a bench in one, a lighthouse in the other.
5. **Your own idea.** One motif of your choice that says "see your home ground again" better than the four above.

## Deliverables

Write files only under `art/logo/`. Do not change any other file. Another process is writing other files under `art/` at this moment: leave them alone.

1. `logo-1.png` to `logo-5.png`: the five proposals, 1024 x 1024, RGB, opaque.
2. `logos-check.png`: one sheet that shows each proposal at 512, 192, 64 and 32 pixels, with its number,
   and each proposal at 192 pixels inside a circle mask and inside a rounded square mask.
3. `prompts.json`: the final prompt of each proposal.
4. `README.md`: one paragraph for each proposal: the idea, and how well it reads at 32 pixels. End with your ranking of the five and the reason.

Use the built-in image generation tool. Open each result and the check sheet. Make a proposal again if it has text, a gradient,
a motif outside the central 80 percent, or a motif that does not read at 64 pixels.
