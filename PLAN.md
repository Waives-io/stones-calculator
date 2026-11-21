# PLAN — מחשבון האבנים הקטנות (WAIVES small-stones calculator)

## Goal
One Hebrew RTL HTML file, vanilla JS, no build step. A manager adds small repetitive
tasks; each one folds into a single line in a shopping-list-style cart, and the cart
shows how many hours a month come back to the team and what share of a full-time
position that frees. Framing is always "time freed for growth" — never money, never
headcount reduction. Sales tool: must look impressive on a shared desktop screen and
work on a phone. No login, no server. GitHub Pages at calc.waives.io.

## Decisions by Galli (not open for re-litigation)
1. **The shopping-list model, 2026-11-21.** The home screen is a LIST, not a form. You
   add an item, fill everything in one sheet, and it folds into one row: icon, name,
   monthly hours. "+ חדש" sits at the TOP LEFT and opens that sheet. The cart total
   lives at the end of the list. A dashboard is reached from the bottom of the app.
2. **The tick box adds and removes a row from the total.** An unticked row stays on
   screen with its own number in grey, struck through, outside the sum — so a meeting
   can ask "what if we drop this one" and watch the total move.
3. **Headcount lives ONLY on the teams screen.** An item picks a team by NAME; it never
   carries a number of people. Changing a headcount updates the whole list at once.
4. **Row icons are automatic, by domain.** Six domains, each with its own WAIVES colour.
   A name typed by hand is matched against the catalog on the way in. Galli never picks
   an icon.
5. **Month basis: 20 working days, 4.5 calendar weeks, a 9-hour day, FTE = 180 h/month.**
   A daily task is multiplied by working days; a weekly task by calendar weeks. The two
   differ on purpose — a month holds about four and a half weeks but you work twenty of
   their days.
6. **The position is a person, not a fraction.** One gold person icon per whole position,
   plus one ring for the remainder that fills towards 100% and becomes another person.
   Wording: "70% משרה פנוי למשימות חשובות אחרות" below one position,
   "משרה ועוד 70% פנויים למשימות חשובות אחרות" above it. Never a bare "0.2 משרה".
7. **No stones anywhere.** The stones are a figure of speech in the name and nothing
   else. The mountain illustration and every stone drawing are gone for good.
8. **Dashboard contents**, in order: hours per month and per year · the position icons
   and ring · the big tasks ranked · a breakdown per team · the closing question
   ("what would you do with the time") · share and copy.

## Approach
- **State**: `{ v:2, groups:[{id,name,people,tasks:[{id,name,minutes,freq,auto,on,dom}]}],
  dream:{chips,text} }`. `on` is the tick. `dom` is the domain index, resolved once on
  the way in and stored BY VALUE so an old link keeps its icon after the catalog changes.
- **Compute**: one pure function `compute(state) -> result`, nothing derived is stored.
  Order per task: `minutes/60 × freqFactor × people × auto`, exact float, rounded last.
- **Rounding invariant (the list must add up on screen)**: the per-row hours are rounded
  with largest-remainder rounding against the exact total of the TICKED rows, so the
  ticked rows sum EXACTLY to the cart total. Under ten hours the list counts in tenths:
  whole numbers there would print "0 ש׳" for a real task and could show two identical
  tasks as 1 and 0. Hours/year and the position figure come from the exact total.
- **The sheet is the calculator.** Its header carries a live number that moves on every
  press, so the list screen can be a list without the tool stopping being a calculator.
  The frequency is a button INSIDE the question ("כמה זמן היא לוקחת פעם ביום?"), never a
  line hidden underneath.
- **Persist**: `localStorage['waives.stones.v1']` in try/catch. Share link is `#s=` +
  base64url of a compact NAMED-key object. Encoding goes through `TextEncoder` because
  `btoa` throws on Hebrew. `migrate()` stays in the file forever; a v1 link (no `o`, no
  `dm`) still opens, every task counted and its icon recovered from its name.
- **Load policy**: a hash is decoded, validated and migrated BEFORE anything local is
  touched, and the previous local scenario waits in the Undo snackbar. A malformed hash
  is ignored with one quiet line.
- **Validation**: `minutes` 0–1440, `people` 1–999, `auto` ∈ {0.25,0.5,0.7,0.9},
  `freq` ∈ {day,week,month,quarter}, names 120 chars, 60 groups, 300 tasks. Unknown
  values are clamped or defaulted; duplicate ids regenerated. Validation never throws.
- **User text is never HTML**: every name is written with `textContent`, inside a `<bdi>`
  that isolates it from the small print — otherwise a name ending in Latin letters
  ("עדכון CRM") drags the next number across the boundary and the row reads scrambled.
- **File sections**: catalog + constants, model + validation, compute, persist + encode +
  migrate, render, events, boot.

## Files
- `index.html` — the entire tool
- `PLAN.md` — this file
- `.nojekyll`, `CNAME` — GitHub Pages
- `qa/qa.js` — 125 Playwright checks (not deployed)
- `design-options/` — the five look directions GPT drew; option 4 was chosen

## Definition of done
`node --check` on the extracted JS, then Playwright covering: the exact calculation
checks under the new constants · the list adds up, read from the screen · the tick box
moves the total and the list still adds up · the sheet's number moves on every press ·
headcount exists only on the teams screen and multiplies the list · a hostile or corrupt
hash (truncated, non-base64, negative minutes, 1e9 people, auto 99, unknown frequency,
unknown domain, `<img src=x onerror=…>`, and a v1 link) · Hebrew and Latin names survive
a round trip · an incoming link with Undo · storage denied · the wording at 0, under a
position, exactly one, two, and above one · no stones, no ₪, no cutting words · RTL and
keyboard · no horizontal overflow at 320/390/768/1280 · ten screenshots.
Then verified live on calc.waives.io against the bytes the site actually serves.
