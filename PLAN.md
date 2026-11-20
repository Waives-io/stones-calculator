# PLAN — מחשבון האבנים הקטנות (WAIVES small-stones calculator)

## Goal
One Hebrew RTL HTML file, vanilla JS, no build step. A manager enters small repetitive
tasks; the tool shows live how many hours per month come back to the team and what share
of a full-time position that frees. Framing is always "time freed for growth" — never
money, never headcount reduction. Sales tool: must look impressive on a shared desktop
screen and work on a phone. No login, no server. Hosted on GitHub Pages at calc.waives.io.

## Decisions already made by Galli (not open for re-litigation)
1. Headcount lives ONLY at the group/role level. The 3-question hook silently creates an
   implicit group ("הצוות שלי", 1 person); the hook's people counter edits that group.
   When a second group exists, the counter moves to the group header with a one-line note.
2. Display shows "0.2 משרה פנויה לפרויקטים" — the growth frame is never detached from the number.
3. Guiding questions: ONE card listing all six, each with a short field and
   "+ להוסיף כמשימה". A small "אחת-אחת" toggle turns it into one-at-a-time for 1:1 meetings.
4. Hook keeps 3 questions. Under the time keys sits a small tappable label
   "כל יום · לשינוי" that opens frequency inline, so the daily assumption is never hidden.
5. Wording: "לדייק את החישוב" (not "לחדד את ההערכה"), "צוות או תפקיד" (not "תפקיד"),
   "יש עוד משימות קטנות?" (not "יש עוד אבנים?"). "אבנים" stays in the title, the mountain
   and the discovery questions.
6. Design/visuals are produced by GPT via a separate design brief. Claude writes logic only
   and does not author or "fix" visual code.

## Approach
- **State**: one object `{ v, mode:'talk'|'solo', groups:[{id,name,domain,people,implicit,
  tasks:[{id,name,minutes,freq,auto,refined,src}]}], dream:{chips,text} }`.
  `implicit` is an explicit stored boolean, never inferred from `groups.length`. It is set
  true only by the hook creating the first group, and is set false permanently the moment
  the user renames that group, assigns it a domain, or adds a second group. Deleting groups
  never promotes a named group back to implicit.
  `src` is a catalog reference for attribution only; name/minutes/freq are stored BY VALUE
  so an old shared link reproduces the exact numbers after the catalog changes.
- **Compute**: one pure function `compute(state) -> result`, no stored derived numbers.
  `result` is the exact shape a future Make webhook will receive; it is not reshaped later.
  Constants: FTE 182 h/month, day 21.7, week 4.33, quarter ÷3.
  Order of operations per task: `minutes/60 × freqFactor × people × auto`, kept as an exact
  float. Nothing is rounded before the end.
- **Rounding invariant (the tape must add up on screen)**: the per-row monthly hours shown
  in the tape are rounded with largest-remainder rounding against the exact total, so the
  displayed rows sum EXACTLY to the displayed total. The big display number is that same
  total. Hours/year and the FTE figure are derived from the exact (unrounded) total, which
  is why 30 hours/month shows as 365 hours/year and not 360 — they are separate lines, never
  a column that must sum. This is stated here because a visible off-by-one in a tape shown
  on a shared screen in a client meeting is the single most embarrassing failure available.
- **Render contract**: `apply(mutation)` → `render(dirty)`, where `dirty` is a set of
  regions (`display | keys | tape | groups | summary`). The default for any mutation is ALL
  regions. The only narrow exception is keystrokes inside a text field, which skip the
  region holding the focused input. There is no "typing vs structural" taxonomy; a mutation
  that does not declare its regions gets a full render.
- **Persist**: `localStorage['waives.stones.v1']` in try/catch. Share link is `#s=` +
  base64url of a compact **named-key** object (`{v,g:[{n,p,t:[{n,m,f,a}]}]}`) — named, not
  positional, so adding a field never shifts the meaning of the others. Encoding goes
  through `TextEncoder` before base64url and `TextDecoder` after, because `btoa` throws on
  Hebrew. `migrate()` chain stays in the file forever.
- **Load policy**: a hash is decoded, validated and migrated BEFORE anything local is
  touched. Only on success does it replace the current scenario, and the previous local
  scenario is held in the Undo snackbar ("נפתח תרחיש מקישור · חזרה לתרחיש שלי") so a link
  never silently destroys the user's own work. A malformed hash is ignored entirely and the
  local scenario loads untouched, with one quiet line: "הקישור לא נקרא, נפתח התרחיש שלך".
- **Validation**: every loaded value is bounded, not trusted. `minutes` 0–1440, `people`
  1–999, `auto` ∈ {0.25,0.5,0.7,0.9}, `freq` ∈ {day,week,month,quarter}, names trimmed to
  120 chars, max 60 groups and 300 tasks. Non-finite or out-of-range numbers are clamped,
  unknown enums fall back to the default, duplicate ids are regenerated, and a task with no
  valid group id is attached to the first group. Validation never throws.
- **User text is never HTML**: task names, group names and the dream answer are written
  with `textContent` only. A shared link is untrusted input and must not be able to inject
  markup or script into the page.
- If the encoded link exceeds ~1800 chars the share button says so and offers
  "העתקת סיכום" instead.
- **Moving a task between groups changes its multiplier.** The tape row shows the people
  count it is multiplied by ("×3 אנשים") and highlights briefly when it changes, so the
  total never jumps without a visible cause.
- **File sections**, in order: catalog + constants, model + validation, compute, persist +
  encode + migrate, render, events, share + undo.
- **Screens**: `calc` and `summary`, same state, so "חזרה לעריכה" loses nothing.
- **Undo**: delete, "דוגמה" and "תרחיש חדש" all pass through `applyState(next)` with a
  10-second snackbar holding the previous state. No confirmation dialogs.

## Files touched
- `index.html` — the entire tool (new)
- `PLAN.md` — this file
- `.nojekyll`, `CNAME` — GitHub Pages
- `qa/` — Playwright QA script and screenshots (not deployed)

## Risks
1. **Trust**: a default 70% automation rate shown before it is explained reads as a sales
   trick. Mitigation: the display's history line shows `× 70%` from the first second, and
   the "הערכה ראשונית · אפשר לדייק" label sits inside the display.
2. **Phone**: a sticky display plus a long key column eats a small screen. Mitigation: the
   display collapses to a single line after the first scroll.
3. **Link length / old links**: compacted encoding plus by-value catalog tasks plus a
   version byte and a migrate chain; a corrupt hash must fail gracefully to an empty
   calculator, never to a blank page.
4. **Focus loss** while typing a task name, if render is too coarse. Mitigation: the render
   contract above, verified in QA by typing a full task name without losing the caret.
5. **Modeling honesty**: 21.7 days assumes a standard working month, and the people
   multiplier assumes everyone in the group does the task for the stated time. The footer
   that shows the formula states both in one line, so the assumption is on screen rather
   than buried in the arithmetic.
6. **A shared link is untrusted input.** Validation, clamping and `textContent`-only
   rendering are what stop a crafted link from producing absurd totals or injecting markup.

## Definition of done
`node --check` on the extracted JS. Playwright QA covering, beyond the brief's own list:
- the three exact calculation checks from the brief (30/365/0.2, 39/469/0.2, 304/3,646/1.7);
- **the tape adds up**: with mixed frequencies, the sum of the displayed rows equals the
  displayed total, checked by reading the rendered text, not the internal numbers;
- a hostile / corrupt hash: truncated, hand-edited, valid JSON with negative minutes,
  `1e9` people, `auto` of 5, an unknown frequency, duplicate ids, and a task name
  containing `<img src=x onerror=...>` — none may break the page or inject markup;
- Hebrew task names survive a round trip through the share link;
- an existing localStorage scenario plus an incoming link: the link loads, and Undo
  restores the user's own scenario;
- a task moved between a 1-person and a 3-person group updates the total visibly;
- the only named group deleted: the survivor is not demoted back into the hook;
- typing a full task name without losing the caret, and keyboard-only navigation;
- storage denied (private mode): the tool still works, nothing throws.
Screenshots at 390px and 1280px: empty, after the hook, "לדייק" open, several tasks with
the tape, and the summary with the mountain. Then verified live on calc.waives.io.
