/* QA for מחשבון האבנים הקטנות (list model).   node qa.js [baseUrl]
   With no argument it serves ../index.html on localhost and tests that. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SHEKEL = String.fromCharCode(8362);
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8777;
const TIME_KEYS = [15, 30, 45, 60, 120];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra){
  if(cond){ pass++; console.log('  ok   ' + name); }
  else{ fail++; failures.push(name + (extra ? '  →  ' + extra : '')); console.log('  FAIL ' + name + (extra ? '  →  ' + extra : '')); }
}
function section(t){ console.log('\n== ' + t); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.051 : tol);

function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, rep) => {
      rep.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      rep.end(fs.readFileSync(path.join(ROOT, 'index.html')));
    });
    srv.listen(PORT, () => res(srv));
  });
}
const enc = obj => Buffer.from(JSON.stringify(obj),'utf8').toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

/* --- helpers that read the SCREEN, not the internals --- */
const numOf = s => Number(String(s).replace(/[^\d.]/g,''));
function minLabel(m){
  if(m < 60) return m + ' דק׳';
  const h = m/60;
  return (Number.isInteger(h) ? h : h.toFixed(1).replace('.0','')) + ' ש׳';
}
async function listNums(p){
  return p.evaluate(() => {
    const n = e => Number(e.textContent.replace(/[^\d.]/g,''));
    const rows = [...document.querySelectorAll('.row')].map(r => ({
      name: r.querySelector('.nm').textContent,
      meta: r.querySelector('.meta').textContent,
      hrs:  n(r.querySelector('.hrs')),
      on:   r.querySelector('.tick').getAttribute('aria-checked') === 'true'
    }));
    const live = rows.filter(r => r.on);
    const tot = document.querySelector('.totalrow .tvalue');
    const groups = [...document.querySelectorAll('.ghead')].map(g => ({
      name: g.querySelector('.gname').textContent,
      tot:  n(g.querySelector('.gtot')),
      open: g.getAttribute('aria-expanded') === 'true'
    }));
    return {
      rows, live, groups,
      sum: Math.round(live.reduce((a,r) => a + r.hrs, 0) * 10) / 10,
      total: tot ? n(tot) : null,
      label: (document.querySelector('.totalrow .tlabel') || {}).textContent || ''
    };
  });
}
async function openSheet(p){
  await p.locator('#btnNew').click();
  await p.waitForSelector('#sheet #fName');
}
async function addTask(p, o){
  await openSheet(p);
  if(o.chip) await p.locator('#sheet .chip', {hasText:o.chip}).first().click();
  if(o.name) await p.locator('#fName').fill(o.name);
  if(o.freq) await p.selectOption('#fFreq', o.freq);
  if(o.minutes !== undefined){
    if(TIME_KEYS.indexOf(o.minutes) !== -1){
      await p.locator('#sheet .chip', {hasText: minLabel(o.minutes)}).first().click();
    }else{
      await p.locator('#fOther').click();
      await p.locator('#fMinutes').fill(String(o.minutes));
    }
  }
  if(o.auto) await p.locator('#sheet .chip', {hasText:o.auto}).first().click();
  if(o.newGroup){
    await p.locator('#fNewGroup').fill(o.newGroup);
    await p.locator('#fAddGroup').click();
    await p.waitForTimeout(120);
  }else if(o.group){
    await p.locator('#sheet .chip', {hasText:o.group}).first().click();
  }
  await p.locator('#sheetSave').click();
  await p.waitForTimeout(160);
}

async function main(){
  const base = process.argv[2];
  let srv = null;
  const url = (base || ('http://localhost:' + PORT + '/')).split('#')[0];
  if(!base) srv = await serve();
  fs.mkdirSync(SHOTS, {recursive:true});

  const browser = await chromium.launch();
  const consoleErrors = [];
  const ctx = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL',
                                        permissions:['clipboard-read','clipboard-write']});
  const page = await ctx.newPage();
  page.on('console', m => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  const fresh = async p => {
    await p.goto(url);
    await p.evaluate(() => { try{ localStorage.clear(); }catch(e){} });
    await p.goto(url);
    await p.waitForTimeout(160);
  };
  await fresh(page);
  const screenText = [];
  /* innerText, not textContent: textContent would also scan the page's own
     <script>, so this would be testing the source instead of the screen. */
  const snapText = async p => { screenText.push(await p.evaluate(() => document.body.innerText)); };

  /* ---------------------------------------------------------- */
  section('1 · הרשימה היא המסך הראשון');
  ok('הכותרת היא מחשבון האבנים הקטנות',
     (await page.locator('#appTitle').textContent()).indexOf('מחשבון האבנים הקטנות') === 0);
  ok('כפתור "חדש" קיים', await page.locator('#btnNew').isVisible());
  ok('כפתור "חדש" בצד שמאל למעלה', await page.evaluate(() => {
    const b = document.getElementById('btnNew').getBoundingClientRect();
    return b.left < window.innerWidth/2 && b.top < 90;
  }));
  ok('המסך הפתוח הוא הרשימה', !(await page.locator('#screenList').isHidden()));
  ok('מסך הגדרות מוסתר', await page.locator('#screenSet').isHidden());
  ok('מסך דשבורד מוסתר', await page.locator('#screenDash').isHidden());
  ok('אין טופס על מסך הרשימה', (await page.locator('#screenList input').count()) === 0);
  ok('מצב ריק מסביר מה לעשות',
     (await page.locator('#screenList').textContent()).indexOf('הרשימה ריקה') !== -1);
  ok('יש כפתור משימה ראשונה', await page.locator('#emptyAdd').isVisible());
  ok('יש כפתור טעינת דוגמה', await page.locator('#emptyDemo').isVisible());
  ok('שלושה מסכים בסרגל התחתון', (await page.locator('nav.bar button').count()) === 3);
  ok('הסרגל התחתון מוביל להגדרות', await page.locator('#navSet').isVisible());
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('2 · הגיליון הוא המחשבון');
  await openSheet(page);
  ok('הגיליון נפתח עם שאלה ראשונה',
     (await page.locator('#sheet').textContent()).indexOf('מה המשימה?') !== -1);
  ok('מספר חי בראש הגיליון', await page.locator('#sheet .sheethead .n').isVisible());
  ok('המספר מתחיל באפס', numOf(await page.locator('#sheet .sheethead .n').textContent()) === 0);
  await page.locator('#sheet .chip', {hasText:'מיון קורות חיים'}).first().click();
  const afterPick = numOf(await page.locator('#sheet .sheethead .n').textContent());
  ok('המספר זז אחרי בחירת משימה מוכנה (' + afterPick + ')', afterPick === 28);
  await page.locator('#sheet .chip', {hasText:'כמעט הכול'}).first().click();
  ok('המספר זז אחרי שינוי אוטומציה',
     numOf(await page.locator('#sheet .sheethead .n').textContent()) === 36);
  ok('התדירות היא תפריט בחירה, לא כפתור מדלג',
     await page.evaluate(() => document.getElementById('fFreq').tagName === 'SELECT'));
  ok('בתפריט התדירות ארבע אפשרויות', (await page.locator('#fFreq option').count()) === 4);
  ok('התדירות יושבת בתוך השאלה', await page.evaluate(() => {
    const l = document.getElementById('fFreq').closest('.qlabel');
    return !!l && l.textContent.indexOf('כמה זמן היא לוקחת') === 0;
  }));
  await page.selectOption('#fFreq', 'week');
  ok('בחירת "פעם בשבוע" משנה את המספר',
     near(numOf(await page.locator('#sheet .sheethead .n').textContent()), 8.1));
  await page.selectOption('#fFreq', 'day');
  ok('יש שאלת שיוך', (await page.locator('#sheet').textContent()).indexOf('למי משויכת המשימה?') !== -1);
  ok('השאלות בגיליון לא מניחות צוות',
     (await page.locator('#sheet .qlabel').allTextContents()).join(' ').indexOf('צוות') === -1);
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(140);
  ok('הגיליון נסגר', await page.locator('#scrim').isHidden());

  /* ---------------------------------------------------------- */
  section('3 · תיבת הדקות מופיעה רק ב"אחר"');
  await openSheet(page);
  ok('תיבת דקות לא קיימת מראש', (await page.locator('#fMinutes').count()) === 0);
  await page.locator('#sheet .chip', {hasText:'30 דק׳'}).first().click();
  ok('אחרי לחיצה על 30 דק׳ אין תיבה נוספת עם 30', (await page.locator('#fMinutes').count()) === 0);
  ok('הכפתור 30 דק׳ מסומן', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet .chip')].filter(x => x.textContent.trim() === '30 דק׳')[0];
    return !!b && b.getAttribute('aria-pressed') === 'true';
  }));
  ok('יש כפתור "אחר"', await page.locator('#fOther').isVisible());
  await page.locator('#fOther').click();
  ok('"אחר" פותח תיבת דקות', await page.locator('#fMinutes').isVisible());
  await page.locator('#fMinutes').fill('25');
  await page.waitForTimeout(120);
  ok('הדקות החופשיות נכנסות לחישוב',
     near(numOf(await page.locator('#sheet .sheethead .n').textContent()), 5.8));
  ok('"אחר" מסומן', (await page.locator('#fOther').getAttribute('aria-pressed')) === 'true');
  await page.locator('#sheet .chip', {hasText:'45 דק׳'}).first().click();
  ok('חזרה לכפתור מוכן סוגרת את התיבה', (await page.locator('#fMinutes').count()) === 0);
  await page.locator('#sheetClose').click();

  /* ---------------------------------------------------------- */
  section('4 · משימה שנכתבת ביד');
  await fresh(page);
  await addTask(page, {name:'מענה לטלפונים של הסניף', minutes:30, freq:'day', auto:'רוב'});
  let L = await listNums(page);
  ok('משימה חופשית נכנסת לרשימה', L.rows.length === 1);
  ok('השם נשמר', L.rows[0].name === 'מענה לטלפונים של הסניף');
  ok('החישוב נכון (7 ש׳)', L.rows[0].hrs === 7);
  ok('המשימה הצטרפה לרשימה המוכנה',
     await page.evaluate(() => window.__waives.lib[0].name === 'מענה לטלפונים של הסניף'));
  await openSheet(page);
  ok('היא מופיעה ככפתור מוכן בגיליון',
     (await page.locator('#sheet .chips').first().textContent()).indexOf('מענה לטלפונים של הסניף') !== -1);
  await page.locator('#sheetClose').click();
  ok('הרשימה המוכנה נשמרת במפתח נפרד',
     await page.evaluate(() => !!localStorage.getItem('waives.stones.lib')));

  /* ---------------------------------------------------------- */
  section('5 · חישוב מדויק לפי הקבועים');
  const calc = await page.evaluate(() => {
    const w = window.__waives;
    return {fte:w.FTE_MONTH, days:w.DAYS_MONTH, weeks:w.WEEKS_MONTH};
  });
  ok('משרה מלאה = 180 שעות', calc.fte === 180);
  ok('20 ימי עבודה בחודש', calc.days === 20);
  ok('4.5 שבועות בחודש', calc.weeks === 4.5);
  const one = async (o, expect, label) => {
    await fresh(page);
    await addTask(page, o);
    const r = await listNums(page);
    ok(label + ' (' + r.rows[0].hrs + ')', near(r.rows[0].hrs, expect));
  };
  await one({name:'יומי', minutes:60, freq:'day', auto:'כמעט הכול'}, 18, 'שעה ביום × 20 × 0.9 = 18');
  await one({name:'שבועי', minutes:120, freq:'week', auto:'חצי'}, 4.5, 'שעתיים בשבוע × 4.5 × 0.5 = 4.5');
  await one({name:'חודשי', minutes:120, freq:'month', auto:'רוב'}, 1.4, 'שעתיים בחודש × 0.7 = 1.4');
  await one({name:'רבעוני', minutes:120, freq:'quarter', auto:'רוב'}, 0.5, 'שעתיים ברבעון = כחצי שעה בחודש');
  await addTask(page, {name:'עוד אחת', minutes:45, freq:'day', auto:'רוב'});
  await addTask(page, {name:'ועוד אחת', minutes:15, freq:'week', auto:'חצי'});
  L = await listNums(page);
  ok('הסכום על המסך = סכום השורות (' + L.total + ')', near(L.total, L.sum, 0.051));
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('6 · הרשימה מסתכמת, כפי שהיא נקראת מהמסך');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(220);
  L = await listNums(page);
  ok('הדוגמה טוענת עשר משימות', L.rows.length === 10);
  ok('סכום הדוגמה 303 שעות (' + L.total + ')', L.total === 303);
  ok('השורות מסתכמות בדיוק לסכום', near(L.sum, L.total, 0.051));
  ok('שורת הסכום כתובה "סה״כ מתפנה החודש"', L.label.indexOf('סה״כ מתפנה החודש') === 0);
  ok('שורת הסכום לא מדברת על שנה', L.label.indexOf('שנה') === -1);
  ok('שורת הסכום לא מדברת על אחוז משרה',
     (await page.locator('.totalrow').textContent()).indexOf('משרה') === -1);
  ok('הסכום בצד שמאל של השורה', await page.evaluate(() => {
    const row = document.querySelector('.totalrow').getBoundingClientRect();
    const v = document.querySelector('.totalrow .tvalue').getBoundingClientRect();
    return (v.left - row.left) < row.width/2;
  }));
  ok('שורת הסכום באותו משקל כמו השורות מעליה', await page.evaluate(() => {
    const a = parseFloat(getComputedStyle(document.querySelector('.totalrow .tvalue')).fontSize);
    const b = parseFloat(getComputedStyle(document.querySelector('.row .hrs')).fontSize);
    return Math.abs(a - b) <= 2;
  }));
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('7 · תיבת הסימון מכניסה ומוציאה מהסכום');
  const before7 = (await listNums(page)).total;
  const firstRow = page.locator('.row').first();
  const firstHrs = numOf(await firstRow.locator('.hrs').textContent());
  await firstRow.locator('.tick').click();
  await page.waitForTimeout(160);
  L = await listNums(page);
  ok('הסרת סימון מקטינה את הסכום', L.total === before7 - firstHrs);
  ok('השורה נשארת על המסך', L.rows.length === 10);
  ok('השורה שהוסרה לא נספרת', L.live.length === 9);
  ok('השורות המסומנות מסתכמות לסכום', near(L.sum, L.total, 0.051));
  await firstRow.locator('.tick').click();
  await page.waitForTimeout(160);
  ok('החזרת הסימון מחזירה את הסכום', (await listNums(page)).total === before7);

  /* ---------------------------------------------------------- */
  section('8 · שיוך: נקרא בשם שלה, ולא נוצר לבד');
  await fresh(page);
  await openSheet(page);
  ok('ברירת המחדל היא "לא משויכת"', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet .chip')].filter(x => x.textContent.trim() === 'לא משויכת')[0];
    return !!b && b.getAttribute('aria-pressed') === 'true';
  }));
  await page.locator('#fName').fill('בדיקה בלי שיוך');
  await page.locator('#sheet .chip', {hasText:'30 דק׳'}).first().click();
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(160);
  ok('לא נוצר שיוך מעצמו', await page.evaluate(() => window.__waives.state.groups.length === 0));
  L = await listNums(page);
  ok('משימה בלי שיוך נספרת פעם אחת', L.rows[0].hrs === 7);
  ok('אין כותרות שיוך כשאין שיוכים', L.groups.length === 0);
  await addTask(page, {name:'השוואת הצעות מחיר', minutes:60, freq:'week', newGroup:'צוות רכש'});
  ok('שיוך חדש נוצר רק כשכותבים אותו',
     await page.evaluate(() => window.__waives.state.groups.length === 1 &&
                               window.__waives.state.groups[0].name === 'צוות רכש'));
  await addTask(page, {name:'מענה לעובדים', minutes:30, freq:'day', newGroup:'צוות רכש'});
  ok('שם שכבר קיים לא יוצר שיוך כפול',
     await page.evaluate(() => window.__waives.state.groups.length === 1));
  ok('שיוך חדש מתחיל באדם אחד',
     await page.evaluate(() => window.__waives.state.groups[0].people === 1));

  /* ---------------------------------------------------------- */
  section('9 · היררכיה לפי שיוך, עם כיווץ');
  L = await listNums(page);
  ok('יש כותרת לשיוך', L.groups.some(g => g.name.indexOf('צוות רכש') !== -1));
  ok('יש כותרת "ללא שיוך"', L.groups.some(g => g.name.indexOf('ללא שיוך') !== -1));
  ok('כותרת השיוך מראה סכום שעות', L.groups[0].tot > 0);
  ok('כל השורות גלויות בהתחלה', L.rows.length === 3);
  const totalBefore9 = L.total;
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(170);
  L = await listNums(page);
  ok('כיווץ מסתיר את הפירוט', L.rows.length === 1);
  ok('הכותרת המכווצת עדיין מראה את הסכום', L.groups[0].tot > 0);
  ok('הסכום הכולל לא זז בכיווץ', L.total === totalBefore9);
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(170);
  ok('פתיחה מחזירה את הפירוט', (await listNums(page)).rows.length === 3);

  /* ---------------------------------------------------------- */
  section('10 · הגדרות: שם העסק, שיוכים, רשימה מוכנה');
  await page.locator('#navSet').click();
  await page.waitForTimeout(170);
  ok('המסך נקרא הגדרות', (await page.locator('#navSet').textContent()).indexOf('הגדרות') !== -1);
  ok('אין יותר מסך בשם צוותים', (await page.locator('nav.bar').textContent()).indexOf('צוותים') === -1);
  ok('יש שדה שם עסק', await page.locator('#fBiz').isVisible());
  await page.locator('#fBiz').fill('משרד עורכי דין לוי');
  await page.waitForTimeout(160);
  ok('שם העסק מצטרף לכותרת',
     (await page.locator('#appTitle').textContent()).indexOf('משרד עורכי דין לוי') !== -1);
  ok('השיוך מופיע בהגדרות',
     (await page.locator('#screenSet .setrow input[type=text]').first().inputValue()) === 'צוות רכש');
  ok('מספר האנשים מוגדר בהגדרות', await page.locator('.stepper').first().isVisible());
  await page.locator('.stepper button').first().click();
  await page.waitForTimeout(170);
  ok('אפשר להוסיף אנשים לשיוך',
     await page.evaluate(() => window.__waives.state.groups[0].people === 2));
  ok('כפתור שיוך חדש קיים', await page.locator('#btnAddGroup').isVisible());
  ok('הרשימה המוכנה מוצגת בהגדרות',
     (await page.locator('#screenSet').textContent()).indexOf('המשימות המוכנות') !== -1);
  const libBefore = await page.evaluate(() => window.__waives.lib.length);
  await page.locator('#screenSet [aria-label^="הסרת"]').first().click();
  await page.waitForTimeout(170);
  ok('אפשר להסיר משימה מוכנה שלא רלוונטית',
     await page.evaluate(l => window.__waives.lib.length === l - 1, libBefore));
  await page.locator('#navList').click();
  await page.waitForTimeout(160);
  ok('יש משימות לפני תרחיש חדש',
     (await page.evaluate(() => window.__waives.state.tasks.length)) === 3);
  await page.locator('#btnMenu').click();
  await page.locator('#menu button', {hasText:'תרחיש חדש'}).click();
  await page.waitForTimeout(200);
  ok('תרחיש חדש מרוקן את הרשימה',
     await page.evaluate(() => window.__waives.state.tasks.length === 0));
  ok('תרחיש חדש לא מחזיר את הרשימה המוכנה המקורית',
     await page.evaluate(l => window.__waives.lib.length === l - 1, libBefore));
  ok('תרחיש חדש מנקה גם את שם העסק',
     (await page.locator('#appTitle').textContent()).indexOf('לוי') === -1);
  await page.locator('#navSet').click();
  await page.waitForTimeout(160);
  await page.locator('#btnLibReset').click();
  await page.waitForTimeout(170);
  ok('אפשר להחזיר את הרשימה המוכנה המקורית',
     await page.evaluate(() => window.__waives.lib.length === 10));
  await page.locator('#navList').click();

  /* ---------------------------------------------------------- */
  section('11 · האייקון מתאים למשימה');
  const iconOf = n => page.evaluate(x => window.__waives.iconFor(x), n);
  ok('מענה לטלפונים → טלפון', (await iconOf('מענה לטלפונים')) === 'phone');
  ok('הקלדת חשבוניות → כספים', (await iconOf('הקלדת חשבוניות ספקים')) === 'money');
  ok('תיאום פגישות ביומן → יומן', (await iconOf('תיאום פגישות ביומן')) === 'calendar');
  ok('מיון קורות חיים → אנשים', (await iconOf('מיון קורות חיים')) === 'people');
  ok('עדכון CRM → נתונים', (await iconOf('עדכון CRM אחרי פגישות')) === 'data');
  ok('תיאום משלוחים → משלוח', (await iconOf('תיאום משלוחים מול מובילים')) === 'truck');
  ok('הפקת דוחות → גרף', (await iconOf('הפקת דוחות חודשיים')) === 'chart');
  ok('מענה לשאלות חוזרות → שיחה', (await iconOf('מענה לשאלות חוזרות')) === 'chat');
  ok('עדכון מלאי → קרטון', (await iconOf('עדכון מלאי')) === 'box');
  ok('משימה בלי מילה מוכרת מקבלת אייקון קבוע', (await iconOf('משהו אחר לגמרי')) === 'clip');
  await fresh(page);
  await addTask(page, {name:'מענה לטלפונים', minutes:30, freq:'day'});
  ok('האייקון על השורה הוא של טלפון', await page.evaluate(() => {
    const d = document.querySelector('.row .ico path').getAttribute('d');
    return d.indexOf('M15.8 21') === 0;
  }));

  /* ---------------------------------------------------------- */
  section('12 · עריכה, מחיקה, ביטול');
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheet #fName');
  ok('לחיצה על שורה פותחת אותה לעריכה',
     (await page.locator('#fName').inputValue()) === 'מענה לטלפונים');
  ok('הגיליון מראה "עדכון משימה"',
     (await page.locator('#sheet .sheethead .t').textContent()).indexOf('עדכון') !== -1);
  await page.locator('#fName').fill('מענה לטלפונים ולמיילים');
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(170);
  L = await listNums(page);
  ok('העריכה נשמרה', L.rows[0].name === 'מענה לטלפונים ולמיילים');
  ok('עריכה לא מוסיפה שורה', L.rows.length === 1);
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheetDelete');
  await page.locator('#sheetDelete').click();
  await page.waitForTimeout(180);
  ok('המחיקה עובדת', (await listNums(page)).rows.length === 0);
  ok('מוצע ביטול', await page.locator('#snackBtn').isVisible());
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(180);
  ok('הביטול מחזיר את המשימה', (await listNums(page)).rows.length === 1);
  await openSheet(page);
  ok('במשימה חדשה אין כפתור מחיקה', (await page.locator('#sheetDelete').count()) === 0);
  await page.locator('#sheetClose').click();

  /* ---------------------------------------------------------- */
  section('13 · שמירה, רענון, קישור');
  await page.reload();
  await page.waitForTimeout(220);
  ok('הרשימה שורדת רענון', (await listNums(page)).rows.length === 1);
  const share = await page.evaluate(() => window.__waives.shareUrl());
  ok('הקישור נבנה', share.indexOf('#s=') !== -1);
  await page.locator('#btnMenu').click();
  ok('בתפריט יש קישור לתרחיש',
     (await page.locator('#menu').textContent()).indexOf('קישור לתרחיש') !== -1);
  ok('אין בתפריט "העתקת סיכום"',
     (await page.locator('#menu').textContent()).indexOf('העתקת סיכום') === -1);
  await page.locator('#menu button', {hasText:'קישור לתרחיש'}).click();
  await page.waitForTimeout(260);
  const toast = await page.locator('#snackText').textContent();
  ok('ההודעה אומרת שהקישור הועתק ("' + toast + '")', toast.indexOf('הועתק') !== -1);
  ok('אין כפתור שיתוף נוסף על המסך', (await page.locator('#screenList #btnShare').count()) === 0);
  ok('המילים "העתקת סיכום" לא קיימות באפליקציה',
     (await page.evaluate(() => document.body.innerText)).indexOf('העתקת סיכום') === -1);
  await page.goto(url);
  await page.waitForTimeout(160);
  await page.goto(url + '#' + share.split('#')[1]);
  await page.waitForTimeout(240);
  ok('קישור נפתח עם אותה משימה', (await listNums(page)).rows.length === 1);
  ok('קישור מציע ביטול', await page.locator('#snackBtn').isVisible());

  /* ---------------------------------------------------------- */
  section('14 · קישורים עוינים');
  const bad = [
    {},
    {v:3, g:'nope', t:'nope'},
    {v:3, g:[{n:'x', p:-5}], t:[{n:'y', m:99999, f:9, a:9, gi:7}]},
    {v:3, g:[{n:'<img src=x onerror=alert(1)>', p:2}], t:[{n:'<script>bad()</script>', m:30, f:0, a:2, gi:0}]},
    {v:1, g:[{n:'צוות ותק', p:2, t:[{n:'משימה מגרסה ראשונה', m:60, f:0, a:2}]}]}
  ];
  for(let i=0; i<bad.length; i++){
    await page.goto(url + '#s=' + enc(bad[i]));
    await page.waitForTimeout(220);
    ok('קישור פגום ' + (i+1) + ' לא מפיל את הדף',
       await page.evaluate(() => !!document.getElementById('btnNew')));
  }
  await page.goto(url + '#s=' + enc(bad[3]));
  await page.waitForTimeout(220);
  ok('קוד בתוך שם נשאר טקסט',
     (await page.locator('.row .nm').first().textContent()).indexOf('<script>') === 0);
  ok('לא נפתח חלון התראה', consoleErrors.filter(e => /alert/.test(e)).length === 0);
  await page.goto(url + '#s=' + enc(bad[4]));
  await page.waitForTimeout(220);
  L = await listNums(page);
  ok('קישור מגרסה ראשונה עדיין נפתח', L.rows.length === 1);
  ok('משימה מגרסה ראשונה נספרת', L.rows[0].on === true);
  ok('מספר האנשים הישן נשמר', L.rows[0].meta.indexOf('×2') !== -1);
  ok('משימה מגרסה ראשונה קיבלה אייקון',
     await page.evaluate(() => !!document.querySelector('.row .ico path')));
  await page.goto(url + '#s=zzzzzz');
  await page.waitForTimeout(240);
  ok('קישור שלא נקרא מסביר את עצמו',
     (await page.locator('#snackText').textContent()).indexOf('לא נקרא') !== -1);

  /* ---------------------------------------------------------- */
  section('15 · אחסון חסום');
  const ctx2 = await browser.newContext({viewport:{width:420, height:900}, locale:'he-IL'});
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => {
    try{
      Object.defineProperty(window, 'localStorage', { get(){ throw new Error('blocked'); } });
    }catch(e){}
  });
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(url);
  await p2.waitForTimeout(240);
  ok('האפליקציה עולה גם בלי אחסון', await p2.evaluate(() => !!document.getElementById('btnNew')));
  await addTask(p2, {name:'בדיקה בלי אחסון', minutes:30, freq:'day'});
  ok('אפשר להוסיף משימה בלי אחסון', (await listNums(p2)).rows.length === 1);
  ok('אין שגיאות בלי אחסון', errs2.length === 0, errs2.join(' | '));
  await ctx2.close();

  /* ---------------------------------------------------------- */
  section('16 · דשבורד: באנר אחד');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(220);
  await page.locator('#navDash').click();
  await page.waitForTimeout(220);
  ok('הדשבורד נפתח', !(await page.locator('#screenDash').isHidden()));
  ok('הרשימה מוסתרת', await page.locator('#screenList').isHidden());
  ok('יש באנר אחד, לא שניים', (await page.locator('#screenDash .banner').count()) === 1);
  const ban = await page.evaluate(() => {
    const b = document.querySelector('#screenDash .banner');
    const sides = [...b.querySelectorAll('.side')];
    return {
      count: sides.length,
      right: sides[0].innerText,
      left: sides[1].innerText,
      rx: sides[0].getBoundingClientRect().right,
      lx: sides[1].getBoundingClientRect().right
    };
  });
  ok('בבאנר שני צדדים', ban.count === 2);
  ok('בצד ימין השעות בחודש', ban.right.indexOf('שעות בחודש') !== -1);
  ok('בצד ימין גם השעות בשנה', ban.right.indexOf('שעות בשנה') !== -1);
  ok('בצד שמאל אחוז המשרה', ban.left.indexOf('%') !== -1);
  ok('הצד הימני אכן מימין', ban.rx > ban.lx);
  ok('המספר בבאנר הוא 303', numOf(ban.right.split('\n')[0]) === 303);
  ok('אחוז המשרה 169%', ban.left.indexOf('169%') !== -1);
  ok('משרה מצוירת כאיש', (await page.locator('#screenDash .banner svg circle[fill]').count()) > 0);
  ok('יש גלגל להשארית', await page.evaluate(() =>
     [...document.querySelectorAll('#screenDash .banner svg circle')]
       .some(c => c.getAttribute('stroke-dasharray'))));
  ok('הניסוח "משרה ועוד 69%"', ban.left.indexOf('משרה ועוד 69%') !== -1);
  ok('באנר קטן שואל מה אפשרי בזמן שהתפנה',
     (await page.locator('.dreambar').textContent()).indexOf('מה אפשרי בזמן שהתפנה?') === 0);
  await page.locator('#screenDash .chip', {hasText:'פרויקט חדש שמחכה'}).first().click();
  await page.waitForTimeout(180);
  ok('מה שסומן מופיע בבאנר הקטן',
     (await page.locator('.dreambar').textContent()).indexOf('פרויקט חדש שמחכה') !== -1);
  ok('יש פירוט איפה הזמן יושב',
     (await page.locator('#screenDash').textContent()).indexOf('איפה הזמן יושב') !== -1);
  ok('יש פירוט לפי שיוך',
     (await page.locator('#screenDash').textContent()).indexOf('לפי שיוך') !== -1);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('17 · ניסוח');
  await page.locator('#navList').click();
  await page.waitForTimeout(170);
  const words = (await page.evaluate(() => window.__waives.freeText(0.2)))
    + ' | ' + (await page.evaluate(() => window.__waives.freeText(1.7)))
    + ' | ' + (await page.evaluate(() => window.__waives.freeText(2)));
  ok('מתחת למשרה: אחוז משרה פנוי', words.indexOf('20% משרה פנוי למשימות חשובות אחרות') !== -1);
  ok('מעל משרה: משרה ועוד אחוזים', words.indexOf('משרה ועוד 70% פנויים') !== -1);
  ok('שתי משרות בלשון רבים', words.indexOf('2 משרות פנויות') !== -1);
  ok('אין "0 משרה פנויה"', words.indexOf('0 משרה פנויה') === -1);
  ok('הכפתור שואל "לא בטוחים מה להוסיף"',
     (await page.locator('#btnTips').textContent()).indexOf('לא בטוחים מה להוסיף') === 0);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('18 · אין אבנים, אין ₪, אין קיצוץ');
  const src = await page.evaluate(() => document.documentElement.outerHTML);
  const seen = screenText.join('\n');
  ok('אין ציור אבנים בקוד', !/function mountain|mountain\(|stoneSvg|pebble|cairn/i.test(src));
  ok('המילה אבנים נשארת רק בשם הכלי',
     (seen.match(/אבנים/g) || []).length === (seen.match(/מחשבון האבנים הקטנות/g) || []).length);
  ok('אין סימן שקל על המסך', seen.indexOf(SHEKEL) === -1);
  ok('אין המילה קיצוץ', seen.indexOf('קיצוץ') === -1 && src.indexOf('קיצוץ') === -1);
  ok('אין המילה פיטורים', seen.indexOf('פיטורים') === -1 && src.indexOf('פיטורים') === -1);
  ok('אין "חיסכון בכוח אדם"', seen.indexOf('חיסכון בכוח אדם') === -1);
  ok('אין "התייעלות"', seen.indexOf('התייעלות') === -1);
  ok('המסר הוא זמן שמתפנה', seen.indexOf('מתפנה') !== -1);

  /* ---------------------------------------------------------- */
  section('19 · הגלילה נשארת במקום, וחלון הטיפים');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(220);
  await page.setViewportSize({width:420, height:700});
  await page.waitForTimeout(170);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(140);
  const y0 = await page.evaluate(() => window.scrollY);
  ok('אפשר לגלול למטה (' + y0 + ')', y0 > 200);
  await page.locator('.row .tick').nth(4).click();
  await page.waitForTimeout(220);
  const y1 = await page.evaluate(() => window.scrollY);
  ok('לחיצה על תיבת סימון לא קופצת לראש הדף (' + y1 + ')', Math.abs(y1 - y0) < 40);
  await page.locator('.row .rowmain').nth(4).click();
  await page.waitForSelector('#sheet #fName');
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(220);
  ok('פתיחה וסגירה של משימה לא קופצות לראש הדף',
     Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 60);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.locator('#btnTips').click();
  await page.waitForTimeout(220);
  ok('הטיפים נפתחים בחלון צף', !(await page.locator('#scrim2').isHidden()));
  const tipTxt = await page.locator('#sheet2').textContent();
  ok('בחלון יש שש שאלות', (await page.locator('#sheet2 .tips li').count()) === 6);
  ok('הטיפים בלשון רבים', tipTxt.indexOf('עשיתם') !== -1 && tipTxt.indexOf('אתם') !== -1);
  ok('אין בטיפים לשון יחיד מגדרית', !/תעשה |עשית |אתה |אתך |בודק /.test(tipTxt));
  ok('מהחלון אפשר להוסיף משימה', await page.locator('#tipsAdd').isVisible());
  await page.locator('#tipsClose').click();
  await page.waitForTimeout(240);
  ok('סגירת הטיפים מחזירה לראש הדף', (await page.evaluate(() => window.scrollY)) === 0);
  ok('החלון נסגר', await page.locator('#scrim2').isHidden());
  await page.locator('#btnTips').click();
  await page.waitForTimeout(180);
  await page.locator('#tipsAdd').click();
  await page.waitForTimeout(220);
  ok('"הוספת משימה" מהטיפים פותח את הגיליון', await page.locator('#fName').isVisible());
  await page.locator('#sheetClose').click();
  await page.setViewportSize({width:1280, height:900});

  /* ---------------------------------------------------------- */
  section('20 · כיווניות, נגישות, רוחב');
  ok('הדף בעברית מימין לשמאל', await page.evaluate(() =>
     document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl'));
  ok('לכל תיבת סימון יש תיאור', await page.evaluate(() =>
     [...document.querySelectorAll('.tick')].every(t => (t.getAttribute('aria-label') || '').length > 3)));
  ok('לכל תיבת סימון יש מצב', await page.evaluate(() =>
     [...document.querySelectorAll('.tick')].every(t => t.hasAttribute('aria-checked'))));
  ok('לכותרת השיוך יש מצב פתיחה', await page.evaluate(() =>
     [...document.querySelectorAll('.ghead')].every(g => g.hasAttribute('aria-expanded'))));
  ok('לכל שדה יש תיאור', await page.evaluate(() =>
     [...document.querySelectorAll('input,select')].every(i =>
       i.getAttribute('aria-label') || (i.id && document.querySelector('label[for="' + i.id + '"]')))));
  ok('הסרגל התחתון מסומן למקרא', await page.evaluate(() =>
     document.querySelector('nav.bar').hasAttribute('aria-label')));
  ok('המסך הפעיל מסומן', await page.evaluate(() =>
     document.getElementById('navList').getAttribute('aria-current') === 'page'));
  for(const w of [360, 420, 768, 1280]){
    await page.setViewportSize({width:w, height:900});
    await page.waitForTimeout(160);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('אין גלילה אופקית ברוחב ' + w + ' (' + over + ')', over <= 1);
  }
  ok('אין שגיאות בקונסול', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

  /* ---------------------------------------------------------- */
  section('21 · צילומי מסך');
  const shots = [];
  const shot = async (n, w) => {
    await page.setViewportSize({width:w || 420, height:900});
    await page.waitForTimeout(240);
    await page.screenshot({path:path.join(SHOTS, n + '.png'), fullPage:true});
    shots.push(n);
  };
  await fresh(page);
  await shot('01-empty');
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
  await shot('02-list');
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(180);
  await shot('03-collapsed');
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(180);
  await openSheet(page);
  await shot('04-sheet');
  await page.locator('#fOther').click();
  await page.waitForTimeout(180);
  await shot('05-other');
  await page.locator('#sheetClose').click();
  await page.locator('#btnTips').click();
  await page.waitForTimeout(220);
  await shot('06-tips');
  await page.locator('#tipsClose').click();
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  await shot('07-dash');
  await page.locator('#navSet').click();
  await page.waitForTimeout(240);
  await shot('08-settings');
  await page.locator('#navList').click();
  await page.waitForTimeout(220);
  await shot('09-list-desktop', 1280);
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  await shot('10-dash-desktop', 1280);
  ok('עשרה צילומי מסך נשמרו (' + shots.length + ')', shots.length === 10);
  ok('כל הצילומים קיימים על הדיסק',
     shots.every(n => fs.existsSync(path.join(SHOTS, n + '.png'))));

  await browser.close();
  if(srv) srv.close();

  console.log('\n──────────────────────────────');
  console.log('עבר: ' + pass + '   נפל: ' + fail);
  if(failures.length){
    console.log('\nנפלו:');
    failures.forEach(f => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
