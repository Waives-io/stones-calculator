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
3. **Assignment is optional, and named by her (2026-11-21).** The question is
   "למי משויכת המשימה?" — not a team. Nothing is ever created automatically: she writes
   "צוות רכש" with three people, or "מנהלת HR" with one, and a task may stay unassigned
   and count once. Headcount lives only in הגדרות, on the assignment itself.
4. **Row icons are automatic, matched from the task's own words.** Thirteen icons
   (telephone, mail, chat, money, chart, calendar, people, document, box, truck, data,
   search) chosen by keyword, strongest words first, with a fixed default for anything
   unrecognised. Galli never picks an icon.
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
8. **The list ends in a plain total row**, the weight of the rows above it: "סה״כ מתפנה
   החודש" on the right, the number on the left. The year and the share of a position
   appear on the dashboard only, never twice.
9. **The dashboard carries ONE banner**: hours per month and per year on the right, the
   share of a position with its people and ring on the left, and a small band under it —
   "מה אפשרי בזמן שהתפנה?" with whatever she ticked. Then the big tasks ranked and the
   breakdown per assignment.
10. **The ready-made task list is hers to keep and prune, and it lives on the LIST
   screen** (2026-11-22): one press adds a task, the ✕ removes it from the ready list.
   It has its own storage key, a task she types joins it automatically, and
   "תרחיש חדש" clears the scenario without bringing the original list back.
11. **הגדרות replaces צוותים**: the business name (which joins the calculator's title)
   and the assignments with their headcount. Nothing else belongs there.
12. **Nothing jumps.** A press keeps the page where it was; only a deliberate move
   between screens, and closing the tips window, returns to the top.
13. **One place per action.** The link is copied from the ⋯ menu and says
   "הקישור הועתק"; "העתקת סיכום" is gone.
14. **The look is the soft mint calculator she attached (2026-11-22), and nothing else.**
   Four objects only: a KEY (near-white face, large radius, soft green-grey shadow, it
   lifts on hover and presses on click), a SCREEN (mint glass with a diagonal sheen —
   the sheet header, the list total, the dashboard banner), a CARD and a PILL. Mint page,
   dark-green text, green for anything chosen or primary, pink for the one key that
   commits (and for the leading bar). No dark surface anywhere. The time and automation
   keys sit on a GRID, like a keypad. GPT drew the token sheet; it is in the file.
15. **The sheet asks in this order**: who it belongs to (free text, empty = nobody),
   what the task is, how long it takes (a dropdown inside the question, presets on a
   grid, "אחר" opening a number with a דקות/שעות switch that re-reads the same number),
   and how much can be automated "(הערכה)". The display carries the task's own name.

16. **The ready-made list holds names and nothing else.** No minutes, no frequency,
   no people: "זה מגוחך להגדיר משהו כזה מראש מתוך ידיעה שכל עסק עובד אחרת לגמרי"
   (2026-11-22). It is edited in two places that share one list — inside "חדש",
   under the question "מה המשימה?", and in הגדרות — and nowhere on the list screen.

17. **The display says both numbers.** The big number is the hours that come back;
   the line under it names the hours the task costs and the share that is automatic.
   She read 10 hours turning into 7 as a bug; the number was right and the screen
   was silent. The per-occurrence cap is 200 hours, so a long monthly task is never
   trimmed behind her back (50 hours used to become 24).

18. **Gold marks what is chosen**: the ring, the "שעות בחודש" label, the current
   screen in the bottom bar, the chosen estimate and the chosen wish. Green stays
   the colour of the keys you press, pink the colour of the one that commits.

## Approach
- **State**: `{ v:3, biz, groups:[{id,name,people}], tasks:[{id,name,minutes,freq,auto,on,
  icon,gid}], dream:{chips,text} }`. Tasks are FLAT and `gid` may be null, because an
  organisation is not necessarily made of teams. `on` is the tick. `icon` is stored BY
  VALUE so an old link keeps its icon after the keyword table changes. The ready-made
  list is a separate store, `localStorage['waives.stones.lib']`, outside the scenario.
- **Compute**: one pure function `compute(state) -> result`, nothing derived is stored.
  Order per task: `minutes/60 × freqFactor × people × auto`, exact float, rounded last.
- **Rounding invariant (the list must add up on screen)**: the per-row hours are rounded
  with largest-remainder rounding against the exact total of the TICKED rows, so the
  ticked rows sum EXACTLY to the cart total. Under ten hours the list counts in tenths:
  whole numbers there would print "0 ש׳" for a real task and could show two identical
  tasks as 1 and 0. Hours/year and the position figure come from the exact total.
- **The sheet is the calculator.** Its header carries a live number that moves on every
  press, so the list screen can be a list without the tool stopping being a calculator.
  The frequency is a dropdown INSIDE the question ("כמה זמן היא לוקחת פעם ביום?"), never a
  line hidden underneath. The minutes box appears only behind 'אחר': a second box showing
  the 30 minutes you just pressed is noise.
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
- `qa/qa.js` — 220 Playwright checks (not deployed)
- `design-options/` — the five look directions GPT drew; option 4 was chosen

## Definition of done
`node --check` on the extracted JS, then Playwright covering: the exact calculation
checks under the new constants · the list adds up, read from the screen · the tick box
moves the total and the list still adds up · the sheet's number moves on every press ·
an assignment is never created by itself, headcount lives only in הגדרות and
multiplies the list · the list is grouped by assignment and each group collapses to its
total · a press does not scroll the page to the top · the icon matches the task · a hostile or corrupt
hash (truncated, non-base64, negative minutes, 1e9 people, auto 99, unknown frequency,
unknown domain, `<img src=x onerror=…>`, and a v1 link) · Hebrew and Latin names survive
a round trip · an incoming link with Undo · storage denied · the wording at 0, under a
position, exactly one, two, and above one · no stones, no ₪, no cutting words · the look itself (mint page, key shadows,
the green screen, the two accent colours, no dark surface) · RTL and keyboard · no horizontal overflow at 320/390/768/1280 · ten screenshots.
Then verified live on calc.waives.io against the bytes the site actually serves.
