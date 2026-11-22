/* QA for מחשבון שעות.   node qa.js [baseUrl]
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

/* The whole folder, not just the page: an installable app is its manifest, its
   icons and its worker, and a harness that answered index.html to every request
   would have reported all three as present whatever they contained. */
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.json':'application/json; charset=utf-8',
               '.webmanifest':'application/manifest+json; charset=utf-8',
               '.png':'image/png', '.svg':'image/svg+xml'};
function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, rep) => {
      let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if(rel === '/' || rel === '') rel = '/index.html';
      const file = path.join(ROOT, path.normalize(rel).replace(/^[\\/]+/, ''));
      if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        rep.writeHead(404, {'Content-Type':'text/plain'});
        return rep.end('no');
      }
      rep.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                          'Cache-Control':'no-store'});
      rep.end(fs.readFileSync(file));
    });
    srv.listen(PORT, () => res(srv));
  });
}
/* A local stand-in for the mapping store, same contract as the Worker: the
   checks never touch the real one and never need the network. */
const STORE_PORT = 8778;
const CODE_AB = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function serveStore(){
  const mem = new Map();
  const state = {down:false, puts:0};
  const srv = http.createServer((req, rep) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const head = {'Content-Type':'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin':'*',
                    'Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,OPTIONS',
                    'Access-Control-Allow-Headers':'Content-Type'};
      const send = (code, obj) => { rep.writeHead(code, head); rep.end(JSON.stringify(obj)); };
      if(req.method === 'OPTIONS'){ rep.writeHead(204, head); return rep.end(); }
      if(state.down) return send(500, {error:'down'});
      const parts = req.url.split('?')[0].split('/').filter(Boolean);
      if(parts[0] !== 'm') return send(404, {error:'not found'});
      if(req.method === 'POST' && parts.length === 1){
        let code = '';
        for(let i=0;i<10;i++) code += CODE_AB[Math.floor(Math.random()*32)];
        mem.set(code, body);
        return send(201, {code});
      }
      const code = parts[1];
      if(!code || code.length !== 10) return send(400, {error:'bad code'});
      if(req.method === 'GET'){
        if(!mem.has(code)) return send(404, {error:'gone'});
        return send(200, {code, body:mem.get(code)});
      }
      if(req.method === 'PUT'){
        if(!mem.has(code)) return send(404, {error:'gone'});
        mem.set(code, body); state.puts++;
        return send(200, {code});
      }
      if(req.method === 'DELETE'){ mem.delete(code); return send(200, {code, deleted:true}); }
      return send(405, {error:'method'});
    });
  });
  return new Promise(res => srv.listen(STORE_PORT, () => res({srv, mem, state})));
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
const sheetNum = async p => numOf(await p.locator('#sheet .sheethead .n').textContent());
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
      label: (document.querySelector('.totalrow .tlabel') || {}).textContent || '',
      ready: [...document.querySelectorAll('.readychip > .chip bdi')].map(b => b.textContent)
    };
  });
}
async function openSheet(p){
  await p.locator('#btnNew').click();
  await p.waitForSelector('#sheet #fName');
}
async function pickTime(p, o){
  if(o.minutes !== undefined && TIME_KEYS.indexOf(o.minutes) !== -1){
    await p.locator('#sheet .chip', {hasText: minLabel(o.minutes)}).first().click();
    return;
  }
  await p.locator('#fOther').click();
  if(o.hours !== undefined){
    await p.locator('#fMinutes').fill(String(o.hours));
    await p.locator('#sheet .chip[data-unit="hr"]').click();
  }else{
    await p.locator('#fMinutes').fill(String(o.minutes));
  }
}
async function addTask(p, o){
  await openSheet(p);
  /* Both open questions are comboboxes: typing opens the list over the questions
     below, and a person closes it before reaching for them. Escape does that. */
  if(o.assign){ await p.locator('#fAssign').fill(o.assign); await p.keyboard.press('Escape'); }
  if(o.name){ await p.locator('#fName').fill(o.name); await p.keyboard.press('Escape'); }
  if(o.freq) await p.selectOption('#fFreq', o.freq);
  if(o.minutes !== undefined || o.hours !== undefined) await pickTime(p, o);
  if(o.auto) await p.locator('#sheet .chip', {hasText:o.auto}).first().click();
  await p.locator('#sheetSave').click();
  await p.waitForTimeout(170);
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
  const store = await serveStore();
  const page = await ctx.newPage();
  /* Runs before the page's own script, so boot() already sees the stand-in. */
  await page.addInitScript(api => { window.__WAIVES_API = api; },
                           'http://localhost:' + STORE_PORT);
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
  /* השליחה חיה בשלוש הנקודות, אז כל בדיקה מגיעה אליה משם. */
  const openSendSheet = async p => {
    await p.locator('#btnMenu').click();
    await p.waitForTimeout(170);
    await p.locator('#menuSend').click();
    await p.waitForTimeout(300);
  };

  /* ---------------------------------------------------------- */
  section('1 · הרשימה היא המסך הראשון');
  ok('הכותרת היא מחשבון שעות',
     (await page.locator('#appTitle').textContent()).trim() === 'מחשבון שעות');
  ok('גם בלשונית הדפדפן', (await page.title()).indexOf('מחשבון שעות') === 0);
  ok('כפתור "חדש" בצד שמאל למעלה', await page.evaluate(() => {
    const b = document.getElementById('btnNew').getBoundingClientRect();
    return b.left < window.innerWidth/2 && b.top < 90;
  }));
  ok('המסך הפתוח הוא הרשימה', !(await page.locator('#screenList').isHidden()));
  ok('הרשימה נקראת בשמה המלא', await page.evaluate(() => {
    const demo = document.getElementById('emptyDemo');
    if(demo) demo.click();
    const h = document.querySelector('#screenList .cardhead h2');
    return !!h && h.textContent === 'רשימת המשימות שחוזרות על עצמן במשרד/בעסק';
  }));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('#screenList');
  ok('מסך הגדרות מוסתר', await page.locator('#screenSet').isHidden());
  ok('מסך דשבורד מוסתר', await page.locator('#screenDash').isHidden());
  ok('אין טופס על מסך הרשימה', (await page.locator('#screenList input').count()) === 0);
  ok('מצב ריק אומר מהי הרשימה',
     (await page.locator('#screenList').textContent()).indexOf('רשימת המשימות שחוזרות על עצמן') !== -1);
  ok('אין כפתור הוספה כפול במצב ריק', (await page.locator('#emptyAdd').count()) === 0);
  ok('יש כפתור טעינת דוגמה', await page.locator('#emptyDemo').isVisible());
  ok('אין משימות מוכנות במסך הרשימה',
     (await page.locator('#screenList .readychip').count()) === 0);
  ok('שלושה מסכים בסרגל התחתון', (await page.locator('nav.bar button').count()) === 3);
  ok('הסרגל התחתון מוביל להגדרות', await page.locator('#navSet').isVisible());
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('2 · הגיליון: סדר השאלות והמספר החי');
  await openSheet(page);
  const labels = await page.locator('#sheet .qlabel').allTextContents();
  ok('השאלה הראשונה היא השיוך', labels[0].indexOf('למי משויכת המשימה?') === 0);
  ok('השאלה השנייה היא שם המשימה', labels[1].indexOf('מה המשימה?') === 0);
  ok('אחריה השאלה על הזמן', labels[2].indexOf('כמה זמן היא לוקחת') === 0);
  ok('השאלה על האוטומציה אומרת שזו הערכה',
     labels[3].indexOf('כמה מזה אפשר להפוך לאוטומטי? (הערכה)') === 0);
  ok('מספר חי בראש הגיליון', await page.locator('#sheet .sheethead .n').isVisible());
  ok('המספר מתחיל באפס', (await sheetNum(page)) === 0);
  ok('בראש הגיליון כתוב מה נבנה כאן',
     (await page.locator('#sheet .tname').textContent()) === 'משימה חדשה שחוזרת על עצמה');
  ok('אין כותרת "משימה חדשה" מעל השם', (await page.locator('#sheet .sheethead .t').count()) === 0);
  await page.locator('#fName').fill('מענה לשאלות חוזרות');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  ok('שם המשימה מופיע בראש הגיליון',
     (await page.locator('#sheet .tname').textContent()) === 'מענה לשאלות חוזרות');
  await page.locator('#sheet .chip', {hasText:'2 ש׳'}).first().click();
  ok('שעתיים ביום = 28 ש׳ בחודש', (await sheetNum(page)) === 28);
  await page.locator('#sheet .chip', {hasText:'כמעט הכול'}).first().click();
  ok('שינוי האוטומציה מזיז את המספר', (await sheetNum(page)) === 36);
  ok('הצג אומר גם כמה המשימה לוקחת',
     (await page.locator('#sheet .u2').textContent()).indexOf('מתוך 40 שעות שהמשימה לוקחת') === 0);
  ok('הצג אומר כמה מזה אוטומטי',
     (await page.locator('#sheet .u2').textContent()).indexOf('90% אוטומטי') !== -1);
  ok('התדירות היא תפריט בחירה, לא כפתור מדלג',
     await page.evaluate(() => document.getElementById('fFreq').tagName === 'SELECT'));
  ok('בתפריט התדירות ארבע אפשרויות', (await page.locator('#fFreq option').count()) === 4);
  ok('התדירות יושבת בתוך השאלה', await page.evaluate(() => {
    const l = document.getElementById('fFreq').closest('.qlabel');
    return !!l && l.textContent.indexOf('כמה זמן היא לוקחת') === 0;
  }));
  await page.selectOption('#fFreq', 'week');
  ok('"פעם בשבוע" משנה את המספר', near(await sheetNum(page), 8.1));
  ok('שאלת השיוך היא רשימה נפתחת',
     (await page.locator('#fAssign').getAttribute('role')) === 'combobox');
  ok('שאלת השם היא רשימה נפתחת',
     (await page.locator('#fName').getAttribute('role')) === 'combobox');
  ok('אין רצועות צ׳יפים פזורות בגיליון',
     (await page.locator('#sheet .readychip').count()) === 0);
  ok('נשארו רק שתי רשתות מקשים: הזמן והאוטומציה',
     (await page.locator('#sheet .chips.grid').count()) === 2);
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(140);
  ok('הגיליון נסגר', await page.locator('#scrim').isHidden());

  /* ---------------------------------------------------------- */
  section('3 · הזמן: כפתורים, "אחר", ודקות מול שעות');
  await openSheet(page);
  ok('תיבת דקות לא קיימת מראש', (await page.locator('#fMinutes').count()) === 0);
  await page.locator('#sheet .chip', {hasText:'30 דק׳'}).first().click();
  ok('אחרי לחיצה על 30 דק׳ אין תיבה נוספת עם 30', (await page.locator('#fMinutes').count()) === 0);
  ok('הכפתור 30 דק׳ מסומן', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet .chip')].filter(x => x.textContent.trim() === '30 דק׳')[0];
    return !!b && b.getAttribute('aria-pressed') === 'true';
  }));
  await page.locator('#fOther').click();
  ok('"אחר" פותח תיבת מספר', await page.locator('#fMinutes').isVisible());
  ok('יש בחירה בין דקות לשעות', (await page.locator('#sheet .chip[data-unit]').count()) === 2);
  ok('ברירת המחדל היא דקות',
     (await page.locator('#sheet .chip[data-unit="min"]').getAttribute('aria-pressed')) === 'true');
  await page.locator('#fMinutes').fill('3');
  await page.waitForTimeout(120);
  ok('3 דקות ביום = 0.7 ש׳ בחודש', near(await sheetNum(page), 0.7));
  await page.locator('#sheet .chip[data-unit="hr"]').click();
  await page.waitForTimeout(120);
  ok('מעבר לשעות קורא את אותו מספר כשעות', near(await sheetNum(page), 42));
  ok('המספר שנכתב נשאר 3', (await page.locator('#fMinutes').inputValue()) === '3');
  ok('"שעות" מסומן',
     (await page.locator('#sheet .chip[data-unit="hr"]').getAttribute('aria-pressed')) === 'true');
  await page.locator('#sheet .chip', {hasText:'45 דק׳'}).first().click();
  ok('חזרה לכפתור מוכן סוגרת את התיבה', (await page.locator('#fMinutes').count()) === 0);
  /* 50 שעות פעם בחודש נחתכו בשקט ל-24 ויצאו 17. המספר חייב להיות מה שנכתב. */
  await page.selectOption('#fFreq', 'month');
  await page.locator('#fOther').click();
  await page.locator('#fMinutes').fill('50');
  await page.locator('#sheet .chip[data-unit="hr"]').click();
  await page.waitForTimeout(140);
  ok('50 שעות פעם בחודש הן 50 שעות, לא 24', await page.evaluate(() =>
     window.__waives.ui.draft.minutes === 3000));
  ok('50 שעות × 70% = 35', (await sheetNum(page)) === 35);
  await page.locator('#fMinutes').fill('10');
  await page.waitForTimeout(140);
  ok('10 שעות × 70% = 7', (await sheetNum(page)) === 7);
  await page.locator('#sheetClose').click();

  /* ---------------------------------------------------------- */
  section('4 · רשימה נפתחת: בוחרים, מסננים, או מוסיפים');
  await fresh(page);
  let L = await listNums(page);
  ok('מסך הרשימה נקי ממשימות מוכנות', (await page.locator('#screenList .readychip').count()) === 0);
  await openSheet(page);
  ok('הרשימה סגורה עד שנוגעים בה', (await page.locator('#sheet .combolist').count()) === 0);
  await page.locator('#fName').click();
  await page.waitForTimeout(170);
  ok('לחיצה פותחת את עשר המשימות',
     (await page.locator('#sheet .combolist .combo-op').count()) === 10);
  ok('השדה מסומן כפתוח',
     (await page.locator('#fName').getAttribute('aria-expanded')) === 'true');
  await page.locator('#fName').fill('פגישות');
  await page.waitForTimeout(170);
  const hits = await page.locator('#sheet .combolist .combo-op:not(.add)').allTextContents();
  ok('הקלדה מסננת את הרשימה (' + hits.length + ')',
     hits.length > 0 && hits.length < 10 && hits.every(t => t.indexOf('פגישות') !== -1));
  ok('מה שלא קיים מוצע להוספה',
     (await page.locator('#sheet .combo-op.add').count()) === 1);
  await page.locator('#sheet .combolist .combo-op', {hasText:'תיאום פגישות ביומן'}).first().click();
  await page.waitForTimeout(170);
  ok('בחירה ממלאת את השם',
     (await page.locator('#fName').inputValue()) === 'תיאום פגישות ביומן');
  ok('הרשימה נסגרת אחרי בחירה', (await page.locator('#sheet .combolist').count()) === 0);
  ok('בחירה לא מוסיפה משימה לרשימה',
     await page.evaluate(() => window.__waives.state.tasks.length === 0));
  await page.locator('#fName').fill('בדיקת מלאי בבוקר');
  await page.waitForTimeout(170);
  await page.locator('#sheet .combo-op.add').click();
  await page.waitForTimeout(170);
  ok('שם חדש נוסף לרשימה מתוך "חדש"',
     await page.evaluate(() => window.__waives.lib[0].name === 'בדיקת מלאי בבוקר'));
  ok('השם החדש נשאר בשדה',
     (await page.locator('#fName').inputValue()) === 'בדיקת מלאי בבוקר');
  ok('אין זמנים שמורים ברשימה',
     await page.evaluate(() => window.__waives.lib.every(x => x.minutes === undefined && x.freq === undefined)));
  await page.locator('#fAssign').click();
  await page.waitForTimeout(170);
  ok('רשימת התפקידים ריקה כשאין תפקידים',
     (await page.locator('#sheet .combolist .combo-op').count()) === 0);
  await page.locator('#fAssign').fill('צוות שירות');
  await page.waitForTimeout(170);
  await page.locator('#sheet .combo-op.add').click();
  await page.waitForTimeout(220);
  ok('תפקיד חדש נוסף מתוך "חדש"',
     await page.evaluate(() => window.__waives.state.groups.length === 1 &&
       window.__waives.state.groups[0].name === 'צוות שירות'));
  await page.locator('#fAssign').click();
  await page.waitForTimeout(170);
  ok('התפקיד מופיע ברשימה בפעם הבאה',
     (await page.locator('#sheet .combolist .combo-op:not(.add)').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(140);
  ok('Escape סוגר את הרשימה ולא את הגיליון',
     (await page.locator('#sheet .combolist').count()) === 0 &&
     !(await page.locator('#scrim').isHidden()));
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(150);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('5 · משימה שנכתבת ביד');
  await fresh(page);
  await addTask(page, {name:'מענה לטלפונים של הסניף', minutes:30, freq:'day', auto:'רוב'});
  L = await listNums(page);
  ok('משימה חופשית נכנסת לרשימה', L.rows.length === 1);
  ok('השם נשמר', L.rows[0].name === 'מענה לטלפונים של הסניף');
  ok('החישוב נכון (7 ש׳)', L.rows[0].hrs === 7);
  ok('המשימה הצטרפה למשימות המוכנות',
     await page.evaluate(() => window.__waives.lib[0].name === 'מענה לטלפונים של הסניף'));
  ok('הרשימה המוכנה נשמרת במפתח נפרד',
     await page.evaluate(() => !!localStorage.getItem('waives.stones.lib')));

  /* ---------------------------------------------------------- */
  section('6 · חישוב מדויק לפי הקבועים');
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
  await one({name:'רבעוני', minutes:120, freq:'quarter', auto:'רוב'}, 0.5, 'שעתיים ברבעון = כחצי שעה');
  await one({name:'שלוש שעות', hours:3, freq:'week', auto:'רוב'}, 9.45, '3 שעות בשבוע × 4.5 × 0.7 = 9.5');
  await addTask(page, {name:'עוד אחת', minutes:45, freq:'day', auto:'רוב'});
  L = await listNums(page);
  ok('הסכום על המסך = סכום השורות (' + L.total + ')', near(L.total, L.sum, 0.051));

  /* ---------------------------------------------------------- */
  section('7 · הרשימה מסתכמת, כפי שהיא נקראת מהמסך');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
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
  ok('שורת הסכום היא מקש ירוק מלא', await page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('.totalrow'));
    const l = getComputedStyle(document.querySelector('.totalrow .tlabel'));
    const r = getComputedStyle(document.querySelector('.row')).backgroundImage;
    return c.backgroundImage.indexOf('134, 196, 115') !== -1 &&
           c.backgroundImage !== r && l.color === 'rgb(255, 255, 255)';
  }));
  ok('לשורת הסכום אותו עומק כמו לכפתור "חדש"', await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector('.totalrow')).boxShadow;
    const b = getComputedStyle(document.querySelector('.newbtn')).boxShadow;
    return a === b && a.indexOf('inset') !== -1;
  }));
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('8 · תיבת הסימון מכניסה ומוציאה מהסכום');
  const before8 = (await listNums(page)).total;
  const firstRow = page.locator('.row').first();
  const firstHrs = numOf(await firstRow.locator('.hrs').textContent());
  await firstRow.locator('.tick').click();
  await page.waitForTimeout(170);
  L = await listNums(page);
  ok('הסרת סימון מקטינה את הסכום', L.total === before8 - firstHrs);
  ok('השורה נשארת על המסך', L.rows.length === 10);
  ok('השורה שהוסרה לא נספרת', L.live.length === 9);
  ok('השורות המסומנות מסתכמות לסכום', near(L.sum, L.total, 0.051));
  await firstRow.locator('.tick').click();
  await page.waitForTimeout(170);
  ok('החזרת הסימון מחזירה את הסכום', (await listNums(page)).total === before8);

  /* ---------------------------------------------------------- */
  section('9 · שיוך: נקרא בשם שלה, ולא נוצר לבד');
  await fresh(page);
  await openSheet(page);
  ok('שדה השיוך ריק כברירת מחדל', (await page.locator('#fAssign').inputValue()) === '');
  ok('אין כפתור "לא משויכת"',
     (await page.locator('#sheet').textContent()).indexOf('לא משויכת') === -1);
  const ph = (await page.locator('#fAssign').getAttribute('placeholder')) || '';
  ok('השדה מזמין לבחור או להקליד', ph.indexOf('בחרו תפקיד') === 0);
  ok('השדה לא מזמין משימה בלי בעלים', ph.indexOf('אפשר להשאיר ריק') === -1);
  await page.locator('#fName').fill('בדיקה בלי שיוך');
  await page.keyboard.press('Escape');
  await page.locator('#sheet .chip', {hasText:'30 דק׳'}).first().click();
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(170);
  ok('לא נוצר שיוך מעצמו', await page.evaluate(() => window.__waives.state.groups.length === 0));
  L = await listNums(page);
  ok('משימה בלי שיוך נספרת פעם אחת', L.rows[0].hrs === 7);
  ok('אין כותרות שיוך כשאין שיוכים', L.groups.length === 0);
  await addTask(page, {name:'השוואת הצעות מחיר', minutes:60, freq:'week', assign:'צוות רכש'});
  ok('שיוך חדש נוצר מהשם שנכתב',
     await page.evaluate(() => window.__waives.state.groups.length === 1 &&
                               window.__waives.state.groups[0].name === 'צוות רכש'));
  await addTask(page, {name:'מענה לעובדים', minutes:30, freq:'day', assign:'צוות רכש'});
  ok('שם שכבר קיים לא יוצר שיוך כפול',
     await page.evaluate(() => window.__waives.state.groups.length === 1));
  ok('שיוך חדש מתחיל באדם אחד',
     await page.evaluate(() => window.__waives.state.groups[0].people === 1));
  await openSheet(page);
  await page.locator('#fAssign').click();
  await page.waitForTimeout(170);
  ok('שיוך קיים מוצע ברשימה',
     (await page.locator('#sheet .combolist .combo-op', {hasText:'צוות רכש'}).count()) === 1);
  await page.locator('#sheet .combolist .combo-op', {hasText:'צוות רכש'}).click();
  await page.waitForTimeout(170);
  ok('בחירה מהרשימה ממלאת את השדה',
     (await page.locator('#fAssign').inputValue()) === 'צוות רכש');
  ok('שיוך קיים לא מוצע שוב כהוספה',
     (await page.locator('#sheet .combo-op.add').count()) === 0);
  await page.locator('#sheetClose').click();

  /* ---------------------------------------------------------- */
  section('10 · היררכיה לפי שיוך, עם כיווץ');
  L = await listNums(page);
  ok('יש כותרת לשיוך', L.groups.some(g => g.name.indexOf('צוות רכש') !== -1));
  ok('יש כותרת "ללא שיוך"', L.groups.some(g => g.name.indexOf('ללא שיוך') !== -1));
  ok('כותרת השיוך מראה סכום שעות', L.groups[0].tot > 0);
  ok('כל השורות גלויות בהתחלה', L.rows.length === 3);
  const total10 = L.total;
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(180);
  L = await listNums(page);
  ok('כיווץ מסתיר את הפירוט', L.rows.length === 1);
  ok('הכותרת המכווצת עדיין מראה את הסכום', L.groups[0].tot > 0);
  ok('הסכום הכולל לא זז בכיווץ', L.total === total10);
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(180);
  ok('פתיחה מחזירה את הפירוט', (await listNums(page)).rows.length === 3);

  /* ---------------------------------------------------------- */
  section('11 · הגדרות: שם העסק והשיוכים בלבד');
  await page.locator('#navSet').click();
  await page.waitForTimeout(180);
  ok('המסך נקרא הגדרות', (await page.locator('#navSet').textContent()).indexOf('הגדרות') !== -1);
  ok('אין יותר מסך בשם צוותים', (await page.locator('nav.bar').textContent()).indexOf('צוותים') === -1);
  ok('הרשימה המוכנה ניתנת לעריכה גם בהגדרות',
     (await page.locator('#screenSet .readychip').count()) > 0);
  ok('בהגדרות הכותרת היא ההסבר כולו',
     (await page.locator('#screenSet .cardhead h2').last().textContent())
       === 'הצעה למשימות אפשריות שחוזרות על עצמן');
  ok('בהגדרות אפשר גם להוסיף שם', await page.locator('#screenSet [data-k="libadd"]').isVisible());
  ok('יש שדה שם עסק', await page.locator('#fBiz').isVisible());
  await page.locator('#fBiz').fill('משרד עורכי דין לוי');
  await page.waitForTimeout(170);
  ok('שם העסק מצטרף לכותרת',
     (await page.locator('#appTitle').textContent()).indexOf('משרד עורכי דין לוי') !== -1);
  ok('השיוך מופיע בהגדרות',
     (await page.locator('#screenSet .setrow input[type=text]').first().inputValue()) === 'צוות רכש');
  ok('מספר האנשים מוגדר בהגדרות', await page.locator('.stepper').first().isVisible());
  await page.locator('.stepper button').first().click();
  await page.waitForTimeout(180);
  ok('אפשר להוסיף אנשים לשיוך',
     await page.evaluate(() => window.__waives.state.groups[0].people === 2));
  ok('כפתור הוספת תפקיד קיים', await page.locator('#btnAddGroup').isVisible());
  ok('הכפתור נקרא "הוסף תפקיד"',
     (await page.locator('#btnAddGroup').textContent()).indexOf('הוסף תפקיד') !== -1);
  await page.locator('#navList').click();
  await page.waitForTimeout(170);
  ok('יש משימות לפני תרחיש חדש',
     (await page.evaluate(() => window.__waives.state.tasks.length)) === 3);
  const libNow = await page.evaluate(() => window.__waives.lib.length);
  await page.locator('#btnMenu').click();
  await page.locator('#menu button', {hasText:'תרחיש חדש'}).click();
  await page.waitForTimeout(220);
  ok('תרחיש חדש מרוקן את הרשימה',
     await page.evaluate(() => window.__waives.state.tasks.length === 0));
  ok('תרחיש חדש לא נוגע במשימות המוכנות',
     await page.evaluate(l => window.__waives.lib.length === l, libNow));
  ok('תרחיש חדש מנקה גם את שם העסק',
     (await page.locator('#appTitle').textContent()).indexOf('לוי') === -1);

  /* ---------------------------------------------------------- */
  section('12 · האייקון מתאים למשימה');
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
  section('13 · עריכה, מחיקה, ביטול');
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheet #fName');
  ok('לחיצה על שורה פותחת אותה לעריכה',
     (await page.locator('#fName').inputValue()) === 'מענה לטלפונים');
  ok('הגיליון מראה "עדכון משימה"',
     (await page.locator('#sheet .sheethead .t').textContent()).indexOf('עדכון') !== -1);
  ok('שם המשימה מופיע בצג', (await page.locator('#sheet .tname').textContent()) === 'מענה לטלפונים');
  await page.locator('#fName').fill('מענה לטלפונים ולמיילים');
  await page.keyboard.press('Escape');
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(180);
  L = await listNums(page);
  ok('העריכה נשמרה', L.rows[0].name === 'מענה לטלפונים ולמיילים');
  ok('עריכה לא מוסיפה שורה', L.rows.length === 1);
  /* המחיקה יושבת על השורה, במקום שבו רואים את המשימה — ולא בשני מקומות. */
  ok('לכל שורה יש כפתור מחיקה',
     (await page.locator('.row .rowx').count()) === (await listNums(page)).rows.length);
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheet #fName');
  ok('בגיליון אין עוד כפתור מחיקה', (await page.locator('#sheetDelete').count()) === 0);
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(170);
  await page.locator('.row .rowx').first().click();
  await page.waitForTimeout(220);
  ok('המחיקה מהשורה עובדת', (await listNums(page)).rows.length === 0);
  ok('מוצע ביטול', await page.locator('#snackBtn').isVisible());
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(190);
  ok('הביטול מחזיר את המשימה', (await listNums(page)).rows.length === 1);

  /* תפקיד קיים כדי לאגד משימות. ירדה האחרונה — יורד איתה. */
  await fresh(page);
  await addTask(page, {assign:'מוקדנית', name:'סגירת קופה יומית', minutes:30, freq:'day'});
  await addTask(page, {assign:'צוות רכש', name:'הזמנת ציוד משרדי', minutes:30, freq:'day'});
  await addTask(page, {assign:'צוות רכש', name:'בדיקת מלאי בבוקר', minutes:30, freq:'day'});
  ok('שלוש משימות ושני תפקידים', await page.evaluate(() =>
     window.__waives.state.tasks.length === 3 && window.__waives.state.groups.length === 2));
  await page.locator('.row', {hasText:'הזמנת ציוד משרדי'}).locator('.rowx').click();
  await page.waitForTimeout(220);
  ok('תפקיד עם משימה נוספת נשאר', await page.evaluate(() =>
     window.__waives.state.groups.filter(g => g.name === 'צוות רכש').length === 1));
  await page.locator('.row', {hasText:'סגירת קופה יומית'}).locator('.rowx').click();
  await page.waitForTimeout(220);
  ok('תפקיד שנשאר בלי משימות יורד איתה', await page.evaluate(() =>
     window.__waives.state.groups.filter(g => g.name === 'מוקדנית').length === 0));
  const gone = await page.locator('#snackText').textContent();
  ok('ההודעה אומרת שגם התפקיד ירד ("' + gone + '")',
     gone.indexOf('מוקדנית') !== -1);
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(220);
  ok('ביטול מחזיר גם את המשימה וגם את התפקיד', await page.evaluate(() =>
     window.__waives.state.tasks.length === 2 &&
     window.__waives.state.groups.filter(g => g.name === 'מוקדנית').length === 1));
  await fresh(page);
  await addTask(page, {assign:'', name:'מענה לטלפונים ולמיילים', minutes:30, freq:'day'});

  /* ---------------------------------------------------------- */
  section('14 · שמירה, רענון, קישור');
  await page.reload();
  await page.waitForTimeout(220);
  ok('הרשימה שורדת רענון', (await listNums(page)).rows.length === 1);
  const share = await page.evaluate(() => window.__waives.shareUrl());
  ok('הקישור נבנה דחוס', share.indexOf('#z=') !== -1);
  await page.locator('#btnMenu').click();
  await page.waitForTimeout(160);
  const menuText = await page.locator('#menu').textContent();
  ok('"קישור לתרחיש" כבר לא קבור בתפריט', menuText.indexOf('קישור לתרחיש') === -1);
  ok('אין בתפריט "העתקת סיכום"', menuText.indexOf('העתקת סיכום') === -1);
  const menuIds = await page.evaluate(() =>
    [...document.querySelectorAll('#menu button')].map(b => b.id));
  ok('בתפריט ארבעה פריטים, בסדר שנקבע',
     menuIds.join(',') === 'menuSend,menuCode,menuDemo,menuReset');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(160);

  /* השליחה היא המעשה שבשבילו הכלי קיים: מנהל ממלא ומעביר לעובד, והוא מחזיר.
     היא יושבת בשלוש הנקודות, ובמקום אחד בלבד. */
  ok('אין יותר מקש שליחה על הרשימה',
     (await page.locator('#screenList #btnSend').count()) === 0);
  ok('אין כפתור שיתוף ישן', (await page.locator('#screenList #btnShare').count()) === 0);
  await openSendSheet(page);
  ok('נפתח מסך שליחה', !(await page.locator('#scrim3').isHidden()));
  const sendTxt = await page.locator('#sheet3').textContent();
  ok('המסך מסביר שמי שמקבל יכול להמשיך ולשלוח בחזרה',
     sendTxt.indexOf('לשלוח בחזרה') !== -1);
  ok('המסך אומר שהנתונים לא נשמרים בשרת',
     sendTxt.indexOf('לא נשמרים בשום שרת') !== -1);
  ok('שלוש דרכים לשלוח',
     (await page.locator('#sendCopy').count()) === 1 &&
     (await page.locator('#sendWa').count()) === 1 &&
     (await page.locator('#sendMail').count()) === 1);
  /* מי ששולח צריך לדעת מאיפה לאיפה זה הולך, לפני שהוא לוחץ. */
  const hint = await page.locator('#sheet3 .sendhint').textContent();
  ok('המסך אומר שהוואטסאפ נפתח אצלם והם בוחרים למי',
     hint.indexOf('נפתח אצלכם') !== -1 && hint.indexOf('בוחרים למי') !== -1);
  ok('והוא אומר שהמייל מעתיק קודם', hint.indexOf('מעתיק את הקישור') !== -1);
  const waUrl = await page.evaluate(async () => {
    let got = null;
    const real = window.open;
    window.open = u => { got = u; return null; };
    document.getElementById('sendWa').click();
    window.open = real;
    return got;
  });
  ok('וואטסאפ נפתח עם הקישור בפנים',
     waUrl.indexOf('https://wa.me/?text=') === 0 && decodeURIComponent(waUrl).indexOf('#z=') !== -1);
  await openSendSheet(page);
  /* "מייל" נכשל בשקט כשאין במחשב תוכנת מייל, אז הקישור חייב להיות ביד בלי קשר. */
  await page.evaluate(() => {
    window.__mailto = null;
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){
      if(String(this.href).indexOf('mailto:') === 0){ window.__mailto = this.href; return; }
      return real.apply(this, arguments);
    };
  });
  await page.locator('#sendMail').click();
  await page.waitForTimeout(600);
  const mailto = await page.evaluate(() => window.__mailto);
  ok('"מייל" מנסה לפתוח את תוכנת המייל עם הקישור בפנים',
     typeof mailto === 'string' && mailto.indexOf('mailto:?subject=') === 0 &&
     decodeURIComponent(mailto).indexOf('#z=') !== -1);
  const mailToast = await page.locator('#snackText').textContent();
  ok('ובמקביל הקישור הועתק, וזה נאמר ("' + mailToast + '")',
     mailToast.indexOf('הועתק') !== -1 && mailToast.indexOf('תוכנת המייל') !== -1);
  ok('מה שהועתק הוא הקישור עצמו',
     (await page.evaluate(() => navigator.clipboard.readText())).indexOf('#z=') !== -1);
  /* ההעתקה חייבת להסתיים לפני שהמייל נפתח: מעבר לתוכנה אחרת מבטל כתיבה
     ללוח שעדיין באוויר, ואז גם הדבר היחיד שתמיד עובד היה נופל. */
  ok('ההעתקה קודמת לפתיחת המייל', (await page.evaluate(
     () => document.documentElement.outerHTML)).indexOf('.then(openMail, openMail)') !== -1);
  await openSendSheet(page);
  await page.locator('#sendCopy').click();
  await page.waitForTimeout(260);
  const toast = await page.locator('#snackText').textContent();
  ok('ההודעה אומרת שהקישור הועתק ("' + toast + '")', toast.indexOf('הועתק') !== -1);
  ok('מסך השליחה נסגר אחרי העתקה', await page.locator('#scrim3').isHidden());
  ok('המילים "העתקת סיכום" לא קיימות באפליקציה',
     (await page.evaluate(() => document.body.innerText)).indexOf('העתקת סיכום') === -1);
  await page.goto(url);
  await page.waitForTimeout(170);
  await page.goto(url + '#' + share.split('#')[1]);
  await page.waitForTimeout(300);
  ok('קישור דחוס נפתח עם אותה משימה', (await listNums(page)).rows.length === 1);
  ok('קישור מציע ביטול', await page.locator('#snackBtn').isVisible());

  /* קישור ישן, לא דחוס, חייב להיפתח לנצח */
  const old = await page.evaluate(() =>
    '#s=' + window.__waives.b64urlEncode(JSON.stringify(window.__waives.pack(window.__waives.state))));
  await page.goto(url);
  await page.waitForTimeout(170);
  await page.goto(url + old);
  await page.waitForTimeout(300);
  ok('קישור ישן בלי דחיסה עדיין נפתח', (await listNums(page)).rows.length === 1);

  /* הדחיסה היא ההבדל בין קישור שנשלח לקישור שהמחשבון מסרב לייצר */
  const sizes = await page.evaluate(async () => {
    const W = window.__waives, s = W.state;
    const names = ['מיון קורות חיים','הקלדת חשבוניות ספקים','מענה לשאלות חוזרות במייל ובוואטסאפ',
      'עדכון CRM אחרי פגישות ושיחות','תיאום פגישות ביומן','מענה לטלפונים ולמיילים כלליים',
      'הפקת דוחות חודשיים','מעקב אחרי תשלומים','קליטת עובד חדש (טפסים, הרשאות, ציוד)',
      'העברת נתונים בין מערכות','בדיקת מלאי בבוקר','הכנת הצעות מחיר ללקוחות',
      'גבייה ותזכורות ללקוחות','התאמות בנק','סידור עבודה שבועי למשמרות',
      'אישור חופשות והיעדרויות','הזמנת ציוד משרדי','עדכון מחירון באתר','שליחת ניוזלטר חודשי',
      'תיוק מסמכים סרוקים','מעקב אחרי חידוש חוזים','בדיקת דוחות שעות','הכנת חומר לישיבת הנהלה',
      'ניתוב פניות לגורם הנכון','תיעוד פניות במערכת','הפקת תעודות משלוח','מענה לביקורות בגוגל',
      'סגירת קופה יומית','הזנת שעות לתוכנת השכר','בדיקת חשבוניות מול הזמנות',
      'הכנת דוח מע״מ','ארכוב מיילים ישנים','עדכון רשימת ספקים','מעקב אחרי תקלות פתוחות',
      'שליחת סקר שביעות רצון','הכנת תלושי שכר','סידור חדר ישיבות לפני פגישה',
      'עדכון סטטוס לקוח בקבוצות וואטסאפ','שליחת עדכונים ותשובות למועמדים',
      'תיאום ראיונות עם מועמדים ומראיינים'];
    const base = JSON.parse(JSON.stringify(s.tasks[0]));
    s.tasks.length = 0;
    names.forEach((n, i) => {
      const t = JSON.parse(JSON.stringify(base));
      t.id = 't' + i; t.name = n; t.minutes = [15,30,45,60,120,180][i % 6];
      s.tasks.push(t);
    });
    const plain = JSON.stringify(window.__waives.pack(s));
    return {tasks:s.tasks.length,
            plain: window.__waives.b64urlEncode(plain).length,
            link: (await W.shareUrl()).length};
  });
  ok('ארבעים משימות נכנסות לקישור אחד (' + sizes.link + ' תווים מול ' + sizes.plain + ')',
     sizes.tasks === 40 && sizes.link < 2200 && sizes.link < sizes.plain / 2);
  await page.goto(url);
  await page.waitForTimeout(200);
  await page.evaluate(() => { try{ localStorage.clear(); }catch(e){} });

  /* ---------------------------------------------------------- */
  section('15 · קישורים עוינים');
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
  section('16 · אחסון חסום');
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
  section('17 · דשבורד: באנר אחד, גלגל אחד');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  ok('הדשבורד נפתח', !(await page.locator('#screenDash').isHidden()));
  ok('הרשימה מוסתרת', await page.locator('#screenList').isHidden());
  ok('יש באנר אחד, לא שניים', (await page.locator('#screenDash .banner').count()) === 1);
  const ban = await page.evaluate(() => {
    const b = document.querySelector('#screenDash .banner');
    const sides = [...b.querySelectorAll('.side')];
    const figs = [...b.querySelectorAll('.fig')].map(f => f.getBoundingClientRect());
    return {
      count: sides.length,
      right: sides[0].innerText,
      left: sides[1].innerText,
      rx: sides[0].getBoundingClientRect().right,
      lx: sides[1].getBoundingClientRect().right,
      figTop: figs.map(f => Math.round(f.top)),
      figMid: figs.map(f => Math.round(f.top + f.height/2)),
      bigSize: parseFloat(getComputedStyle(b.querySelector('.big')).fontSize),
      ringSize: parseFloat(getComputedStyle(b.querySelector('.ringnum')).fontSize)
    };
  });
  ok('בבאנר שני צדדים', ban.count === 2);
  ok('שני הצדדים באותו גובה', ban.figMid[0] === ban.figMid[1]);
  ok('הפונט של המספר לא ענק (' + ban.bigSize + ')', ban.bigSize <= 36);
  ok('האחוז בתוך הגלגל (' + ban.ringSize + ')', ban.ringSize <= 30);
  ok('בצד ימין השעות בחודש', ban.right.indexOf('שעות בחודש') !== -1);
  ok('בצד ימין גם השעות בשנה', ban.right.indexOf('שעות בשנה') !== -1);
  ok('הצד הימני אכן מימין', ban.rx > ban.lx);
  ok('המספר בבאנר הוא 303', numOf(ban.right.split('\n')[0]) === 303);
  ok('בצד שמאל רק אחוז ותווית', ban.left.replace(/\s+/g,' ').trim() === '169% מתוך משרה מלאה');
  ok('אין ציורי אנשים בבאנר',
     (await page.locator('#screenDash .banner svg circle[fill]:not([stroke])').count()) === 0);
  ok('יש גלגל אחד בבאנר', await page.evaluate(() =>
     [...document.querySelectorAll('#screenDash .banner svg circle')]
       .filter(c => c.getAttribute('stroke-dasharray')).length === 1));
  ok('באנר קטן שואל מה אפשרי בזמן שהתפנה',
     (await page.locator('.dreambar').textContent()).indexOf('מה אפשרי בזמן שהתפנה?') === 0);
  const dream = await page.evaluate(() => ({
    q: getComputedStyle(document.querySelector('.dreambar .k')).color,
    a: getComputedStyle(document.querySelector('.dreambar b')).color,
    line: getComputedStyle(document.querySelector('.dreambar b')).display
  }));
  ok('השאלה כתובה בכהה', dream.q === 'rgb(30, 66, 32)');
  ok('התשובה כתובה בוורוד בשורה נפרדת',
     dream.a === 'rgb(178, 58, 98)' && dream.line === 'block');
  ok('השורה היא כפתור שמוביל לשאלה', await page.evaluate(() => {
    const b = document.querySelector('.dreambar');
    return b.tagName === 'BUTTON' && !!document.getElementById('dreamBlock');
  }));
  await page.locator('#screenDash .chip', {hasText:'פרויקט חדש שמחכה'}).first().click();
  await page.waitForTimeout(190);
  ok('מה שסומן מופיע בבאנר הקטן',
     (await page.locator('.dreambar').textContent()).indexOf('פרויקט חדש שמחכה') !== -1);
  ok('"איפה הזמן יושב?" היא כותרת אחת',
     (await page.locator('#screenDash .block h3', {hasText:'איפה הזמן יושב?'}).count()) === 1);
  const subs = await page.locator('#screenDash .bargroup .ghead .gname').allTextContents();
  ok('מתחתיה "לפי משימה" ואחריה "לפי תפקיד"',
     subs[0] === 'לפי משימה' && subs[1] === 'לפי תפקיד');
  ok('אין יותר "לפי שיוך" בדשבורד',
     (await page.locator('#screenDash .bargroup', {hasText:'לפי שיוך'}).count()) === 0);
  ok('אין יותר כותרת שטוחה בדשבורד',
     (await page.locator('#screenDash .subh').count()) === 0);
  /* שתי הכותרות הן אותו אובייקט כמו קבוצת תפקיד ברשימה — מקש מורם שמתקפל. */
  const headLook = await page.evaluate(() => {
    const d = getComputedStyle(document.querySelector('#screenDash .bargroup .ghead'));
    document.getElementById('navList').click();
    const l = getComputedStyle(document.querySelector('#screenList .ghead'));
    const out = {dashBg:d.backgroundImage, dashSh:d.boxShadow,
                 listBg:l.backgroundImage, listSh:l.boxShadow};
    document.getElementById('navDash').click();
    return out;
  });
  ok('כותרת בדשבורד היא אותו מקש כמו קבוצה ברשימה',
     headLook.dashBg === headLook.listBg && headLook.dashSh === headLook.listSh &&
     headLook.dashSh.indexOf('inset') !== -1);
  /* אותו חיתוך, אותם נתונים: שני המספרים חייבים להיות אותו מספר, ושווים לבאנר. */
  const sums = await page.evaluate(() => ({
    task: document.querySelector('#subtask .gtot').textContent.trim(),
    role: document.querySelector('#subrole .gtot').textContent.trim(),
    banner: document.querySelector('#screenDash .banner .big').textContent.trim()
  }));
  ok('שתי הכותרות מציגות את אותו סכום (' + sums.task + ' / ' + sums.role + ')',
     sums.task === sums.role);
  ok('והוא הסכום שבבאנר (' + sums.banner + ')',
     sums.task.indexOf(sums.banner) === 0);
  /* "לפי משימה" הציגה פעם רק שש — ואז שתי הכותרות סתרו זו את זו. */
  ok('"לפי משימה" מציגה את כל המשימות הפעילות',
     (await page.locator('#screenDash .bar-item.pinkbar').count()) ===
     (await page.evaluate(() => window.__waives.compute().live.length)));
  const tones = await page.evaluate(() => {
    const g = sel => [...document.querySelectorAll(sel)]
      .map(b => getComputedStyle(b.querySelector('.bar-fill')).backgroundImage);
    return {pink: g('#screenDash .bar-item.pinkbar'), gold: g('#screenDash .bar-item.goldbar')};
  });
  ok('כל הברים של המשימות ורודים (' + tones.pink.length + ')',
     tones.pink.length > 1 && tones.pink.every(b => b.indexOf('247, 121, 159') !== -1));
  ok('כל הברים של השיוכים צהובים (' + tones.gold.length + ')',
     tones.gold.length > 0 && tones.gold.every(b => b.indexOf('233, 182, 74') !== -1));
  ok('אין בר ירוק בודד שמתחזה לכותרת',
     (await page.locator('#screenDash .bar-item:not(.pinkbar):not(.goldbar)').count()) === 0);
  ok('שתי הכותרות הן כפתורים פתוחים',
     (await page.locator('#subtask').getAttribute('aria-expanded')) === 'true' &&
     (await page.locator('#subrole').getAttribute('aria-expanded')) === 'true');
  const pinkCount = await page.locator('#screenDash .bar-item.pinkbar').count();
  await page.locator('#subtask').click();
  await page.waitForTimeout(190);
  ok('לחיצה על "לפי משימה" מקפלת רק אותה',
     (await page.locator('#screenDash .bar-item.pinkbar').count()) === 0 &&
     (await page.locator('#screenDash .bar-item.goldbar').count()) > 0);
  ok('הכותרת מסומנת כמקופלת',
     (await page.locator('#subtask').getAttribute('aria-expanded')) === 'false');
  await page.locator('#subtask').click();
  await page.waitForTimeout(190);
  ok('לחיצה נוספת פותחת אותה בחזרה',
     (await page.locator('#screenDash .bar-item.pinkbar').count()) === pinkCount);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('18 · ניסוח');
  await page.locator('#navList').click();
  await page.waitForTimeout(180);
  const words = (await page.evaluate(() => window.__waives.freeText(0.2)))
    + ' | ' + (await page.evaluate(() => window.__waives.freeText(1.7)))
    + ' | ' + (await page.evaluate(() => window.__waives.freeText(2)));
  ok('מתחת למשרה: אחוז משרה פנוי', words.indexOf('20% משרה פנוי למשימות חשובות אחרות') !== -1);
  ok('מעל משרה: משרה ועוד אחוזים', words.indexOf('משרה ועוד 70% פנויים') !== -1);
  ok('שתי משרות בלשון רבים', words.indexOf('2 משרות פנויות') !== -1);
  ok('אין "0 משרה פנויה"', words.indexOf('0 משרה פנויה') === -1);
  const tipText = (await page.locator('#btnTips').textContent()).trim();
  ok('הכפתור מזמין ללחוץ לעזרה', tipText === 'לחצו לקבלת עזרה אילו עוד משימות ניתן להוריד מהיומיום שלכם');
  ok('הכפתור קצר ממשפט וחצי', tipText.length < 70);
  const tipLook = await page.evaluate(() => {
    const b = document.getElementById('btnTips');
    const row = document.querySelector('#screenList .row');
    /* "הוספה לרשימה" lives in the sheet, so it is measured where it is */
    document.getElementById('btnNew').click();
    const save = getComputedStyle(document.getElementById('sheetSave'));
    const out = {bg:getComputedStyle(b).backgroundImage, ink:getComputedStyle(b).color,
                 sh:getComputedStyle(b).boxShadow,
                 saveBg:save.backgroundImage, saveSh:save.boxShadow,
                 rowBg: row ? getComputedStyle(row).backgroundImage : 'none'};
    document.getElementById('sheetClose').click();
    return out;
  });
  ok('הכפתור נבדל מהשורות ברשימה', tipLook.bg !== tipLook.rowBg);
  ok('הכפתור הוא בדיוק המקש של "הוספה לרשימה"',
     tipLook.bg === tipLook.saveBg && tipLook.sh === tipLook.saveSh);
  ok('הכיתוב עליו לבן', tipLook.ink === 'rgb(255, 255, 255)');
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('19 · אין אבנים, אין ₪, אין קיצוץ');
  const src = await page.evaluate(() => document.documentElement.outerHTML);
  const seen = screenText.join('\n');
  ok('אין ציור אבנים בקוד', !/function mountain|mountain\(|stoneSvg|pebble|cairn/i.test(src));
  ok('המילה אבנים ירדה מהמסך לגמרי', seen.indexOf('אבנים') === -1);
  ok('אין סימן שקל על המסך', seen.indexOf(SHEKEL) === -1);
  ok('אין המילה קיצוץ', seen.indexOf('קיצוץ') === -1 && src.indexOf('קיצוץ') === -1);
  ok('אין המילה פיטורים', seen.indexOf('פיטורים') === -1 && src.indexOf('פיטורים') === -1);
  ok('אין "חיסכון בכוח אדם"', seen.indexOf('חיסכון בכוח אדם') === -1);
  ok('אין "התייעלות"', seen.indexOf('התייעלות') === -1);
  ok('המסר הוא זמן שמתפנה', seen.indexOf('מתפנה') !== -1);

  /* ---------------------------------------------------------- */
  section('20 · שום דבר לא קופץ');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
  await page.setViewportSize({width:420, height:700});
  await page.waitForTimeout(180);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(140);
  const y0 = await page.evaluate(() => window.scrollY);
  ok('אפשר לגלול למטה (' + y0 + ')', y0 > 200);
  await page.locator('.row .tick').nth(4).click();
  await page.waitForTimeout(220);
  ok('לחיצה על תיבת סימון לא קופצת לראש הדף',
     Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 40);
  /* A short screen, so the sheet really has somewhere to scroll. */
  await page.setViewportSize({width:420, height:520});
  await page.waitForTimeout(160);
  await page.locator('.row .rowmain').nth(4).click();
  await page.waitForSelector('#sheet #fName');
  /* the sheet itself must not jump back to its first question. Scroll down to the
     time question the way a person does, and only then start measuring. */
  await page.locator('#sheet .chip', {hasText:'45 דק׳'}).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(160);
  const s0 = await page.evaluate(() => document.querySelector('.sheetbody').scrollTop);
  ok('אפשר לגלול בתוך הגיליון (' + s0 + ')', s0 > 100);
  await page.locator('#sheet .chip', {hasText:'45 דק׳'}).first().click();
  await page.waitForTimeout(200);
  ok('בחירת זמן לא מקפיצה את הגיליון לראש',
     Math.abs((await page.evaluate(() => document.querySelector('.sheetbody').scrollTop)) - s0) < 30);
  await page.selectOption('#fFreq', 'week');
  await page.waitForTimeout(200);
  ok('בחירת תדירות לא מקפיצה את הגיליון לראש',
     Math.abs((await page.evaluate(() => document.querySelector('.sheetbody').scrollTop)) - s0) < 30);
  await page.locator('#sheetClose').click();
  await page.waitForTimeout(200);
  await page.setViewportSize({width:420, height:700});
  await page.waitForTimeout(160);
  ok('סגירת הגיליון לא קופצת לראש הדף',
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
  await page.setViewportSize({width:1280, height:900});

  /* ---------------------------------------------------------- */
  section('21 · כיווניות, נגישות, רוחב');
  ok('הדף בעברית מימין לשמאל', await page.evaluate(() =>
     document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl'));
  ok('לכל תיבת סימון יש תיאור', await page.evaluate(() =>
     [...document.querySelectorAll('.tick')].every(t => (t.getAttribute('aria-label') || '').length > 3)));
  ok('לכל תיבת סימון יש מצב', await page.evaluate(() =>
     [...document.querySelectorAll('.tick')].every(t => t.hasAttribute('aria-checked'))));
  ok('לכותרת השיוך יש מצב פתיחה', await page.evaluate(() =>
     [...document.querySelectorAll('.ghead')].every(g => g.hasAttribute('aria-expanded'))));
  ok('לכל כפתור הסרה יש תיאור', await page.evaluate(() =>
     [...document.querySelectorAll('.chipx')].every(b => (b.getAttribute('aria-label') || '').length > 3)));
  ok('לכל שדה יש תיאור', await page.evaluate(() =>
     [...document.querySelectorAll('input,select')].every(i =>
       i.getAttribute('aria-label') || (i.id && document.querySelector('label[for="' + i.id + '"]')))));
  ok('הסרגל התחתון מסומן למקרא', await page.evaluate(() =>
     document.querySelector('nav.bar').hasAttribute('aria-label')));
  ok('המסך הפעיל מסומן', await page.evaluate(() =>
     document.getElementById('navList').getAttribute('aria-current') === 'page'));
  for(const w of [360, 420, 768, 1280]){
    await page.setViewportSize({width:w, height:900});
    await page.waitForTimeout(170);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('אין גלילה אופקית ברוחב ' + w + ' (' + over + ')', over <= 1);
  }
  ok('אין שגיאות בקונסול', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

  /* ---------------------------------------------------------- */
  section('22 · הנראות: מקשים רכים וצג ירוק');
  const look = await page.evaluate(() => {
    const cs = n => getComputedStyle(document.querySelector(n));
    const root = getComputedStyle(document.documentElement);
    return {
      bg: cs('body').backgroundColor,
      sheetBg: (() => {
        document.getElementById('btnNew').click();
        const c = getComputedStyle(document.querySelector('#sheet')).backgroundColor;
        document.getElementById('sheetClose').click();
        return c;
      })(),
      rowShadow: cs('.row').boxShadow,
      rowRadius: cs('.row').borderTopLeftRadius,
      rowFace: cs('.row').backgroundImage,
      screen: cs('.totalrow').backgroundImage,
      green: root.getPropertyValue('--green').trim(),
      pink: root.getPropertyValue('--pink').trim(),
      ink: root.getPropertyValue('--ink').trim(),
      darkCount: [...document.querySelectorAll('#screenList *, nav.bar, .top')].filter(e => {
        const c = getComputedStyle(e).backgroundColor.match(/\d+/g);
        if(!c) return false;
        if(c.length > 3 && Number(c[3]) === 0) return false;
        return (Number(c[0]) + Number(c[1]) + Number(c[2])) / 3 < 90;
      }).length
    };
  });
  ok('הרקע מנטה בהיר', look.bg === 'rgb(231, 236, 230)');
  ok('הרקע של הדף הוא הרקע של הגיליון', look.bg === look.sheetBg);
  /* A key has a thickness: a bright top edge, a dark bottom edge that reads as its
     side, a tight contact shadow, and a wide soft one for the height. */
  const shadowParts = look.rowShadow.split(/,(?![^(]*\))/).map(x => x.trim());
  ok('שורה היא מקש רך עם צל', look.rowShadow.indexOf('inset') !== -1);
  ok('למקש יש קצה עליון בהיר', shadowParts.some(x =>
     x.indexOf('inset') !== -1 && x.indexOf('rgb(255, 255, 255)') !== -1));
  ok('למקש יש צד תחתון כהה', shadowParts.some(x =>
     x.indexOf('inset') !== -1 && /-[\d.]+px 0px/.test(x)));
  ok('למקש יש ארבעה רבדים של עומק לפחות (' + shadowParts.length + ')',
     shadowParts.length >= 4);
  ok('לשורה פינות גדולות (' + look.rowRadius + ')', parseFloat(look.rowRadius) >= 18);
  ok('פני המקש הם מעבר מלבן', look.rowFace.indexOf('gradient') !== -1 && look.rowFace.indexOf('rgb(255, 255, 255)') !== -1);
  ok('שורת הסכום היא צג ירוק', look.screen.indexOf('gradient') !== -1);
  ok('הירוק של התמונה', look.green === '#7FBE6C');
  ok('הוורוד של התמונה', look.pink === '#F7799F');
  ok('הטקסט ירוק כהה', look.ink === '#1E4220');
  ok('אין משטחים כהים באפליקציה (' + look.darkCount + ')', look.darkCount === 0);
  ok('כפתור השמירה הוא המקש הוורוד', await page.evaluate(() => {
    document.getElementById('btnNew').click();
    const b = document.getElementById('sheetSave');
    const bg = getComputedStyle(b).backgroundImage;
    const got = bg.indexOf('247, 121, 159') !== -1;
    document.getElementById('sheetClose').click();
    return got;
  }));

  /* כל מסך הוא מסך "חדש": הכותרת על הרקע, ומתחתיה מקשים. קופסה לבנה מאחורי מקש
     לבן בולעת את הצל שנותן לו את העומק — וזה מה שהשטיח את הדשבורד וההגדרות. */
  for(const [nav, screen, label] of [['#navSet','#screenSet','הגדרות'],
                                     ['#navDash','#screenDash','דשבורד'],
                                     ['#navList','#screenList','הרשימה']]){
    await page.locator(nav).click();
    await page.waitForTimeout(220);
    const box = await page.evaluate(sel => {
      const c = [...document.querySelectorAll(sel + ' > .card')]
        .map(e => getComputedStyle(e));
      return {n:c.length, bg:c.map(x => x.backgroundColor), sh:c.map(x => x.boxShadow)};
    }, screen);
    ok('אין קופסה לבנה מאחורי ה' + label,
       box.n > 0 && box.bg.every(b => b === 'rgba(0, 0, 0, 0)') &&
       box.sh.every(h => h === 'none'));
  }
  await page.locator('#navSet').click();
  await page.waitForTimeout(220);
  const adds = await page.evaluate(() => {
    const a = document.getElementById('btnAddGroup');
    const b = [...document.querySelectorAll('#screenSet .btn')]
      .filter(x => x.textContent.trim() === 'הוספה')[0];
    const cs = e => getComputedStyle(e);
    return {bgA:cs(a).backgroundImage, bgB:b ? cs(b).backgroundImage : 'missing',
            inkA:cs(a).color};
  });
  ok('"+ הוסף תפקיד" באותו משקל כמו "הוספה"', adds.bgA === adds.bgB);
  ok('הכיתוב עליו לבן, לא חיוור', adds.inkA === 'rgb(255, 255, 255)');

  /* מקש מלא הוא אותו מקש בכל מקום, ולהערת המשרה המלאה יש מסך אחד */
  const solids = await page.evaluate(() => {
    const out = {};
    document.getElementById('navList').click();
    out.newbtn = getComputedStyle(document.querySelector('.newbtn')).boxShadow;
    out.total = getComputedStyle(document.querySelector('.totalrow')).boxShadow;
    out.tips = getComputedStyle(document.getElementById('btnTips')).boxShadow;
    document.getElementById('btnNew').click();
    out.freq = getComputedStyle(document.getElementById('fFreq')).boxShadow;
    out.save = getComputedStyle(document.getElementById('sheetSave')).boxShadow;
    document.getElementById('sheetClose').click();
    document.getElementById('navSet').click();
    out.addGroup = getComputedStyle(document.getElementById('btnAddGroup')).boxShadow;
    document.getElementById('navList').click();
    return out;
  });
  ok('"חדש", הסכום, התדירות ו"הוסף תפקיד" חולקים עומק אחד',
     solids.newbtn === solids.total && solids.total === solids.freq &&
     solids.freq === solids.addGroup && solids.newbtn.indexOf('inset') !== -1);
  ok('המקשים הוורודים חולקים עומק אחד משלהם',
     solids.tips === solids.save && solids.tips !== solids.newbtn);
  const banner = await page.evaluate(() => {
    document.getElementById('navDash').click();
    const sh = getComputedStyle(document.querySelector('#screenDash .banner')).boxShadow;
    document.getElementById('navList').click();
    return sh;
  });
  ok('גם הבאנר עם המספרים מורם מהדף',
     banner.indexOf('inset') !== -1 && /\b1[0-9]px\b|\b2[0-9]px\b/.test(banner));
  for(const [nav, screen, want] of [['#navList','הרשימה',false],
                                    ['#navSet','הגדרות',false],
                                    ['#navDash','דשבורד',true]]){
    await page.locator(nav).click();
    await page.waitForTimeout(200);
    const shown = await page.locator('#formula').isVisible();
    ok('הערת המשרה המלאה ' + (want ? 'מופיעה ב' : 'לא מופיעה ב') + screen, shown === want);
  }
  await page.locator('#navList').click();
  await page.waitForTimeout(200);

  /* כפתור "חדש" יושב בתוך עמודת העמוד, גם כשהחלון רחב מהעמודה */
  await page.locator('#navList').click();
  await page.waitForTimeout(220);
  for(const w of [430, 868, 1280]){
    await page.setViewportSize({width:w, height:900});
    await page.waitForTimeout(200);
    const edge = await page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const n = r('.newbtn'), row = r('#screenList .row'), nav = r('nav.bar button');
      return {nl:Math.round(n.left), nr:Math.round(n.right),
              rl:Math.round(row.left), rr:Math.round(row.right),
              vl:Math.round(nav.left), vr:Math.round(nav.right)};
    });
    ok('ברוחב ' + w + ' כפתור "חדש" לא חורג מהעמודה',
       edge.nl >= edge.rl - 1 && edge.nr <= edge.rr + 1,
       'new ' + edge.nl + '-' + edge.nr + ', row ' + edge.rl + '-' + edge.rr);
    ok('ברוחב ' + w + ' הסרגל התחתון מיושר לעמודה',
       edge.vl >= edge.rl - 1 && edge.vr <= edge.rr + 1,
       'nav ' + edge.vl + '-' + edge.vr + ', row ' + edge.rl + '-' + edge.rr);
  }
  await page.setViewportSize({width:1280, height:900});
  await page.waitForTimeout(200);

  /* ---------------------------------------------------------- */
  section('23 · אזהרה לפני מחיקה, אפשרות משלה, ותפריט במקום');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);

  /* התפריט נפתח ליד שלוש הנקודות, לא בקצה החלון. position:fixed נמדד מול החלון,
     והכפתור יושב בקצה עמודה של 720 פיקסלים — על מסך רחב אלו שני מקומות שונים. */
  await page.setViewportSize({width:1280, height:900});
  await page.waitForTimeout(200);
  await page.locator('#btnMenu').click();
  await page.waitForTimeout(190);
  const mp = await page.evaluate(() => {
    const m = document.getElementById('menu').getBoundingClientRect();
    const b = document.getElementById('btnMenu').getBoundingClientRect();
    return {ml:m.left, mr:m.right, bc:(b.left + b.right)/2};
  });
  ok('התפריט נפתח מתחת לשלוש הנקודות', mp.bc > mp.ml && mp.bc < mp.mr,
     'menu ' + Math.round(mp.ml) + '-' + Math.round(mp.mr) + ', dots ' + Math.round(mp.bc));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.setViewportSize({width:430, height:950});
  await page.waitForTimeout(190);

  /* מחיקת תפקיד שמשויכות אליו משימות שואלת קודם */
  await page.locator('#navSet').click();
  await page.waitForTimeout(220);
  const groups0 = await page.evaluate(() => window.__waives.state.groups.length);
  await page.locator('#screenSet .setrow .danger').first().click();
  await page.waitForTimeout(200);
  ok('מחיקת תפקיד בשימוש פותחת שאלה', !(await page.locator('#scrim3').isHidden()));
  const askTxt = await page.locator('#sheet3').textContent();
  ok('השאלה אומרת כמה משימות משויכות', /\d/.test(askTxt) && askTxt.indexOf('משויך') !== -1);
  ok('השאלה אומרת מה יקרה למשימות', askTxt.indexOf('ללא שיוך') !== -1);
  await page.locator('#askNo').click();
  await page.waitForTimeout(190);
  ok('ביטול לא מוחק דבר',
     (await page.evaluate(() => window.__waives.state.groups.length)) === groups0);
  await page.locator('#screenSet .setrow .danger').first().click();
  await page.waitForTimeout(200);
  await page.locator('#askYes').click();
  await page.waitForTimeout(240);
  ok('אישור מוחק את התפקיד',
     (await page.evaluate(() => window.__waives.state.groups.length)) === groups0 - 1);
  ok('המשימות נשארו, בלי שיוך', await page.evaluate(() =>
     window.__waives.state.tasks.filter(t => t.gid === null).length > 0));

  /* הסרת הצעה ששם שלה כבר בשימוש ברשימה */
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
  const used = 'מיון קורות חיים';
  await page.locator('#navSet').click();
  await page.waitForTimeout(220);
  const chipx = page.locator('#screenSet .readychip',
    {has: page.locator('bdi', {hasText: used})}).locator('.chipx').first();
  await chipx.click();
  await page.waitForTimeout(200);
  ok('הסרת הצעה בשימוש פותחת שאלה', !(await page.locator('#scrim3').isHidden()));
  const libTxt = await page.locator('#sheet3').textContent();
  ok('השאלה אומרת שהמשימות נשארות', libTxt.indexOf('נשארות ברשימה') !== -1);
  ok('השאלה מסבירה איפה מוחקים את המשימה עצמה',
     libTxt.indexOf('מסך הרשימה') !== -1);
  await page.locator('#askYes').click();
  await page.waitForTimeout(240);
  ok('ההצעה ירדה מהרשימה הנפתחת',
     await page.evaluate(n => window.__waives.lib.every(x => x.name !== n), used));
  await page.locator('#navList').click();
  await page.waitForTimeout(220);
  ok('המשימה עצמה נשארה ברשימה עם השם שלה',
     (await page.locator('.row .nm', {hasText: used}).count()) === 1);

  /* אפשרות משלה ב"מה הייתם עושים עם הזמן הזה" */
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  await page.locator('#fDream').fill('לפתוח סניף נוסף');
  await page.locator('#btnDreamAdd').click();
  await page.waitForTimeout(240);
  ok('האפשרות שהוקלדה הפכה לכפתור',
     (await page.locator('#dreamBlock .chip', {hasText:'לפתוח סניף נוסף'}).count()) === 1);
  ok('האפשרות נבחרה מיד', await page.evaluate(() =>
     window.__waives.state.dream.chips.indexOf('לפתוח סניף נוסף') !== -1));
  ok('האפשרות מופיעה בבאנר הקטן',
     (await page.locator('.dreambar').textContent()).indexOf('לפתוח סניף נוסף') !== -1);
  ok('השדה התרוקן אחרי ההוספה', (await page.locator('#fDream').inputValue()) === '');
  await page.locator('#fDream').fill('לקחת שבוע חופש');
  await page.locator('#fDream').press('Enter');
  await page.waitForTimeout(240);
  ok('גם אנטר מוסיף', await page.evaluate(() =>
     window.__waives.state.dream.custom.length === 2));
  await page.reload();
  await page.waitForTimeout(260);
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  ok('האפשרויות שלה נשמרות אחרי רענון', await page.evaluate(() =>
     window.__waives.state.dream.custom.indexOf('לפתוח סניף נוסף') !== -1 &&
     window.__waives.state.dream.chips.indexOf('לקחת שבוע חופש') !== -1));
  ok('רק האפשרויות שלה ניתנות להסרה',
     (await page.locator('#dreamBlock .chipx').count()) === 2);
  await page.locator('#dreamBlock .readychip',
    {has: page.locator('bdi', {hasText:'לקחת שבוע חופש'})}).locator('.chipx').click();
  await page.waitForTimeout(240);
  ok('הסרה מורידה אותה גם מהנבחרות', await page.evaluate(() =>
     window.__waives.state.dream.custom.length === 1 &&
     window.__waives.state.dream.chips.indexOf('לקחת שבוע חופש') === -1));
  ok('שש ההצעות הקבועות נשארו',
     (await page.locator('#dreamBlock .chip').count()) === 7);
  /* קישור שיתוף נושא איתו גם את מה שהיא הוסיפה */
  const dreamLink = await page.evaluate(() => window.__waives.shareUrl());
  await page.goto(dreamLink);
  await page.waitForTimeout(300);
  ok('הקישור נושא את האפשרות שלה', await page.evaluate(() =>
     window.__waives.state.dream.custom.indexOf('לפתוח סניף נוסף') !== -1));
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('24 · שמירה בענן: קוד אחד שעובר בין אנשים');
  await fresh(page);
  ok('הדף מדבר עם החנות המקומית, לא עם האמיתית',
     (await page.evaluate(() => window.__waives.cloudApi)) === 'http://localhost:' + STORE_PORT);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(260);
  ok('בלי קוד אין שורת ענן על הרשימה', (await page.locator('#cloudBar').count()) === 0);
  await openSendSheet(page);
  ok('מוצעת שמירה בענן', (await page.locator('#sendCloud').count()) === 1);
  /* זה המסלול שמחזיק את הכלי בין אנשים ומכשירים, אז הוא מקש מלא ולא כפתור חיוור. */
  ok('ההצעה היא מקש מלא, לא כפתור חיוור', await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('sendCloud'));
    return c.color === 'rgb(255, 255, 255)' && c.boxShadow.indexOf('inset') !== -1 &&
           c.backgroundImage.indexOf('247, 121, 159') !== -1;
  }));
  ok('עוד אין קוד להראות', (await page.locator('#sendCode').count()) === 0);
  ok('המסך אומר שכלום לא נשמר בשרת',
     (await page.locator('#sheet3').textContent()).indexOf('לא נשמרים בשום שרת') !== -1);
  await page.locator('#sendCloud').click();
  await page.waitForTimeout(700);
  const code = await page.evaluate(() => window.__waives.cloud.code);
  ok('התקבל קוד בן עשרה תווים (' + code + ')',
     typeof code === 'string' && /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code));
  ok('המיפוי אכן יושב בחנות', store.mem.has(code));
  ok('מה שנשמר הוא המטען הדחוס', (store.mem.get(code) || '')[0] === 'z');
  ok('הקוד מוצג למשתמשת',
     (await page.locator('#sendCode').textContent()).indexOf(code.slice(0,5)) !== -1);
  ok('המסך אומר מי יכול לראות ולערוך',
     (await page.locator('#sheet3').textContent()).indexOf('לראות ולערוך') !== -1);
  const shortUrl = await page.evaluate(() => {
    let got = null;
    const real = window.open;
    window.open = u => { got = u; return null; };
    document.getElementById('sendWa').click();
    window.open = real;
    return decodeURIComponent(got);
  });
  ok('הקישור ששולחים הוא הקצר', shortUrl.indexOf('#k=' + code) !== -1 &&
     shortUrl.indexOf('#z=') === -1);
  await page.waitForTimeout(200);
  ok('שורת הענן מופיעה על הרשימה עם הקוד',
     (await page.locator('#cloudBar').textContent()).indexOf('שמור בענן') === 0);

  /* שינוי אצל אחד — נשמר למי שיפתח אחריו */
  const before = store.mem.get(code);
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(3400);
  ok('שינוי נשמר בענן מעצמו', store.mem.get(code) !== before);

  /* מכשיר אחר, אותו מיפוי */
  const rows = (await listNums(page)).rows.length;
  await fresh(page);
  ok('המכשיר השני מתחיל ריק', (await listNums(page)).rows.length === 0);
  await page.goto(url + '#k=' + code);
  await page.waitForTimeout(900);
  ok('הקוד פותח את המיפוי במכשיר אחר', (await listNums(page)).rows.length === rows);
  ok('המכשיר השני ממשיך לעבוד על אותו קוד',
     (await page.evaluate(() => window.__waives.cloud.code)) === code);
  const before2 = store.mem.get(code);
  await addTask(page, {assign:'מוקדנית', name:'סגירת קופה יומית', minutes:30, freq:'day'});
  await page.waitForTimeout(3400);
  ok('גם מה שהוא מוסיף חוזר לענן', store.mem.get(code) !== before2);

  /* חנות שנפלה נאמרת בקול, ולא בשקט */
  store.state.down = true;
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(3400);
  ok('כשהשמירה נכשלת זה כתוב על המסך',
     (await page.locator('#cloudBar.bad').count()) === 1 &&
     (await page.locator('#cloudBar').textContent()).indexOf('שמור אצלכם במכשיר') !== -1);
  store.state.down = false;
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(3400);
  ok('וכשהיא חוזרת, האזהרה יורדת', (await page.locator('#cloudBar.bad').count()) === 0);

  /* אלף כתיבות ביום בשכבה החופשית. הקלדת שם משימה קוראת ל-save על כל אות,
     אז בלי השהייה והשוואה מיפוי אחד היה שורף מאה כתיבות על אותו תוכן. */
  store.state.puts = 0;
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheet #fName');
  await page.locator('#fName').fill('מענה לשאלות חוזרות במייל ובוואטסאפ ובטלפון');
  await page.keyboard.press('Escape');
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(3400);
  ok('הקלדה שלמה עולה כתיבה אחת (' + store.state.puts + ')',
     store.state.puts === 1);
  await page.waitForTimeout(3000);
  ok('בלי שינוי אין כתיבה בכלל (' + store.state.puts + ')', store.state.puts === 1);
  await page.locator('.row .tick').first().click();
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(3400);
  ok('שינוי שחזר לעצמו לא נכתב שוב (' + store.state.puts + ')', store.state.puts === 1);

  /* קוד שני שמודבק לתוך לשונית פתוחה — בלי טעינה מחדש */
  await fresh(page);
  await addTask(page, {assign:'מזכירות', name:'תיוק מסמכים סרוקים', minutes:45, freq:'day'});
  await openSendSheet(page);
  await page.locator('#sendCloud').click();
  await page.waitForTimeout(700);
  const second = await page.evaluate(() => window.__waives.cloud.code);
  ok('מיפוי שני קיבל קוד משלו', second !== code && store.mem.has(second));
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);
  await page.evaluate(c => { location.hash = 'k=' + c; }, code);
  await page.waitForTimeout(1200);
  ok('הדבקת קוד אחר בלשונית פתוחה מחליפה את המיפוי',
     (await page.evaluate(() => window.__waives.cloud.code)) === code &&
     (await listNums(page)).rows.length > 1);
  ok('ושורת הענן מתעדכנת לקוד החדש',
     (await page.locator('#cloudBar').textContent()).indexOf(code.slice(0,5)) !== -1);
  ok('ומוצע ביטול', await page.locator('#snackBtn').isVisible());
  await page.evaluate(c => { location.hash = 'k=' + c; }, code);
  await page.waitForTimeout(600);
  ok('הדבקה חוזרת של אותו קוד לא עושה דבר',
     (await page.evaluate(() => window.__waives.cloud.code)) === code);

  /* הדרך החוצה */
  await openSendSheet(page);
  await page.locator('#sendOff').click();
  await page.waitForTimeout(260);
  const offTxt = await page.locator('#sheet3').textContent();
  ok('המחיקה מהענן שואלת קודם', !(await page.locator('#scrim3').isHidden()));
  ok('השאלה אומרת שהקוד יפסיק לעבוד', offTxt.indexOf('יפסיק לעבוד') !== -1);
  ok('השאלה אומרת שהמיפוי נשאר במכשיר', offTxt.indexOf('נשאר אצלכם במכשיר') !== -1);
  await page.locator('#askYes').click();
  await page.waitForTimeout(500);
  ok('המיפוי ירד מהחנות', !store.mem.has(code));
  ok('המכשיר כבר לא קשור לקוד',
     (await page.evaluate(() => window.__waives.cloud.code)) === null);
  ok('שורת הענן נעלמה', (await page.locator('#cloudBar').count()) === 0);
  ok('המשימות נשארו במכשיר', (await listNums(page)).rows.length > 0);
  await page.goto(url + '#k=' + code);
  await page.waitForTimeout(700);
  ok('קוד שנמחק אומר זאת',
     (await page.locator('#snackText').textContent()).indexOf('לא נמצא') !== -1);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('25 · הקוד מקבל איפה להיכנס');
  await fresh(page);
  ok('מסך ריק מציע להקליד קוד', (await page.locator('#emptyCode').count()) === 1);
  ok('והשורה אומרת למה היא שם',
     (await page.locator('.emptyor').textContent()).indexOf('קיבלתם קוד') === 0);
  await page.locator('#emptyCode').click();
  await page.waitForTimeout(240);
  ok('נפתח מסך להזנת קוד', (await page.locator('#fCode').count()) === 1);
  ok('הכותרת אומרת מה עושים כאן',
     (await page.locator('#askTitle').textContent()).indexOf('קוד') !== -1);
  ok('הסמן כבר בשדה', (await page.evaluate(() => document.activeElement.id)) === 'fCode');

  /* קוד קצר נעצר כאן, בלי לצאת לרשת בכלל */
  const putsBefore = store.state.puts;
  const getsBefore = store.mem.size;
  await page.locator('#fCode').fill('ABC');
  await page.locator('#codeOpen').click();
  await page.waitForTimeout(220);
  ok('קוד קצר מקבל תשובה מיד',
     (await page.locator('#codeBad').textContent()).indexOf('עשרה תווים') !== -1);
  ok('ושום דבר לא נשלח לחנות', store.mem.size === getsBefore && store.state.puts === putsBefore);

  /* קוד תקין שלא קיים — נאמר בלי להחליף כלום */
  await page.locator('#fCode').fill('2V0C2C8YG1');
  await page.locator('#codeOpen').click();
  await page.waitForTimeout(500);
  ok('קוד שלא קיים נאמר בפירוש',
     (await page.locator('#codeBad').textContent()).indexOf('לא מצאנו') !== -1);
  ok('המסך נשאר פתוח כדי לתקן', (await page.locator('#fCode').count()) === 1);
  ok('הכפתור חוזר לעצמו',
     (await page.locator('#codeOpen').textContent()) === 'פתיחת המיפוי');
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);

  /* מיפוי אמיתי, קוד אמיתי, ומכשיר שני שמקליד אותו ביד */
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(300);
  await openSendSheet(page);
  await page.locator('#sendCloud').click();
  await page.waitForTimeout(700);
  const mine = await page.evaluate(() => window.__waives.cloud.code);
  const pretty = await page.evaluate(c => window.__waives.prettyCode(c), mine);
  const rowsHere = (await listNums(page)).rows.length;
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);

  /* שורת הענן היא הדרך חזרה אל הקוד, בלי לחפש */
  await page.locator('#cloudBar').click();
  await page.waitForTimeout(300);
  ok('לחיצה על שורת הענן פותחת את השליחה',
     (await page.locator('#sendCode').count()) === 1);
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);

  await fresh(page);
  ok('המכשיר השני מתחיל ריק', (await listNums(page)).rows.length === 0);
  await page.locator('#btnMenu').click();
  await page.waitForTimeout(170);
  await page.locator('#menuCode').click();
  await page.waitForTimeout(240);
  /* כמו שמקלידים קוד שהוקרא בטלפון: אותיות קטנות, עם המקף */
  await page.locator('#fCode').fill(pretty.toLowerCase());
  await page.locator('#fCode').press('Enter');
  await page.waitForTimeout(800);
  ok('הקוד פותח את המיפוי', (await listNums(page)).rows.length === rowsHere);
  ok('והמכשיר מחובר אליו', (await page.evaluate(() => window.__waives.cloud.code)) === mine);
  ok('הכתובת נושאת את הקוד', (await page.evaluate(() => location.hash)) === '#k=' + mine);
  ok('שורת הענן מראה את הקוד',
     (await page.locator('#cloudBar').textContent()).indexOf(pretty) !== -1);
  ok('מסך הקוד נסגר מעצמו', await page.locator('#scrim3').isHidden());

  /* ביטול מחזיר את מה שהיה — וגם משחרר את הקוד של האחר */
  ok('מוצע ביטול', await page.locator('#snackBtn').isVisible());
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(300);
  ok('הביטול מחזיר את המיפוי שהיה כאן', (await listNums(page)).rows.length === 0);
  ok('והוא מרפה מהקוד של האחר',
     (await page.evaluate(() => window.__waives.cloud.code)) === null);
  ok('הכתובת כבר לא נושאת אותו',
     (await page.evaluate(() => location.hash)).indexOf('k=') === -1);
  const after = store.mem.get(mine);
  await addTask(page, {assign:'מוקדנית', name:'סגירת קופה יומית', minutes:30, freq:'day'});
  await page.waitForTimeout(1900);
  ok('ומה שנכתב כאן אחרי הביטול לא נוגע במיפוי שלו', store.mem.get(mine) === after);

  /* I, L, O, U הן האותיות שאין באלפבית הזה, ומי שמקליד מתכוון למה שדומה להן */
  const folded = await page.evaluate(() => [
    window.__waives.tidyCode(' 2v0c2-c8ygz '),
    window.__waives.tidyCode('iloc2c8ygz'),
    window.__waives.tidyCode('2V0C2*C8YGZ')
  ]);
  ok('מקף, רווחים ואותיות קטנות לא מפריעים', folded[0] === '2V0C2C8YGZ');
  ok('I ו-L נקראות 1, O נקראת 0 (' + folded[1] + ')', folded[1] === '110C2C8YGZ');
  ok('תו זר נופל ולא מזיז את השאר', folded[2] === '2V0C2C8YGZ');
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('26 · אפליקציה שאפשר להתקין');
  await fresh(page);
  ok('יש manifest מקושר מהדף', (await page.evaluate(() => {
    const l = document.querySelector('link[rel="manifest"]');
    return l ? l.getAttribute('href') : null;
  })) === 'manifest.webmanifest');
  const mres = await page.request.get(url + 'manifest.webmanifest');
  ok('הוא באמת נמצא על השרת', mres.ok());
  const man = await mres.json();
  ok('השם מתחת לאייקון הוא "מחשבון שעות"', man.short_name === 'מחשבון שעות');
  ok('השם המלא נושא גם את WAIVES', (man.name || '').indexOf('WAIVES') !== -1);
  ok('היא נפתחת כאפליקציה ולא כלשונית', man.display === 'standalone');
  ok('עברית מימין לשמאל', man.lang === 'he' && man.dir === 'rtl');
  ok('הכתובת שנפתחת היא יחסית, אז היא עובדת בכל תיקייה',
     man.start_url === './' && man.scope === './');
  ok('הרקע תואם לרקע של האפליקציה',
     man.background_color === '#E7ECE6' && man.theme_color === '#E7ECE6');
  ok('יש אייקון maskable לאנדרואיד',
     (man.icons || []).some(i => (i.purpose || '').indexOf('maskable') !== -1));
  const iconSizes = [];
  for(const ic of (man.icons || [])){
    const r = await page.request.get(url + ic.src);
    if(!r.ok()){ iconSizes.push(ic.src + ':404'); continue; }
    const buf = await r.body();
    const png = buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    iconSizes.push(ic.src + ':' + (png ? buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20) : 'not-png'));
  }
  ok('כל האייקונים קיימים ובגודל שהוכרז (' + iconSizes.join(' ') + ')',
     iconSizes.length === (man.icons || []).length &&
     iconSizes.every((t, i) => t.split(':')[1] === man.icons[i].sizes));
  const apple = await page.evaluate(() => {
    const l = document.querySelector('link[rel="apple-touch-icon"]');
    return l ? l.getAttribute('href') : null;
  });
  ok('יש אייקון לאייפון', apple === 'icons/apple-touch-icon.png');
  ok('והוא על השרת', (await page.request.get(url + apple)).ok());
  ok('שם האפליקציה מוגדר גם לאייפון', (await page.evaluate(() => {
    const m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    return m ? m.content : null;
  })) === 'מחשבון שעות');
  ok('צבע הסרגל תואם לרקע', (await page.evaluate(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    return m ? m.content : null;
  })) === '#E7ECE6');

  const swRes = await page.request.get(url + 'sw.js');
  ok('שכבת האופליין קיימת', swRes.ok());
  const swSrc = await swRes.text();
  ok('הדף עצמו נמשך מהרשת קודם, והקאש הוא רק רשת ביטחון',
     swSrc.indexOf("req.mode === 'navigate'") !== -1 && swSrc.indexOf('caches.match') !== -1);
  ok('חנות המיפויים לא נשמרת בקאש', swSrc.indexOf('workers.dev') !== -1);
  ok('גרסה ישנה נמחקת כשעולה חדשה', swSrc.indexOf('caches.delete') !== -1);
  const pageSrc = await page.evaluate(() => document.documentElement.outerHTML);
  ok('הרישום רץ רק על האתר האמיתי, לא על עותק מקומי',
     pageSrc.indexOf("location.protocol === 'https:'") !== -1);
  ok('ובבדיקות עצמן לא נרשם worker',
     (await page.evaluate(() => navigator.serviceWorker ?
        navigator.serviceWorker.getRegistrations().then(r => r.length) : 0)) === 0);
  await snapText(page);

  /* ---------------------------------------------------------- */
  section('27 · צילומי מסך');
  const shots = [];
  const shot = async (n, w) => {
    await page.setViewportSize({width:w || 430, height:950});
    await page.waitForTimeout(240);
    await page.screenshot({path:path.join(SHOTS, n + '.png'), fullPage:true});
    shots.push(n);
  };
  await fresh(page);
  await shot('01-empty');
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(240);
  await page.evaluate(() => { document.getElementById('snack').hidden = true; });
  await shot('02-list');
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(190);
  await shot('03-collapsed');
  await page.locator('.ghead').first().click();
  await page.waitForTimeout(190);
  await openSheet(page);
  await shot('04-sheet');
  await page.locator('#fOther').click();
  await page.waitForTimeout(190);
  await shot('05-other');
  await page.locator('#sheetClose').click();
  await page.locator('#btnTips').click();
  await page.waitForTimeout(230);
  await shot('06-tips');
  await page.locator('#tipsClose').click();
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  await shot('07-dash');
  await page.locator('#navSet').click();
  await page.waitForTimeout(240);
  await shot('08-settings');
  await page.locator('#navList').click();
  await page.waitForTimeout(230);
  await shot('09-list-desktop', 1280);
  await page.locator('#navDash').click();
  await page.waitForTimeout(240);
  await shot('10-dash-desktop', 1280);
  await page.setViewportSize({width:430, height:950});
  await page.locator('#navList').click();
  await page.waitForTimeout(220);
  await page.locator('#btnMenu').click();
  await page.waitForTimeout(170);
  await page.locator('#menuSend').click();
  await page.waitForTimeout(320);
  await shot('11-send');
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);
  await page.locator('#btnMenu').click();
  await page.waitForTimeout(170);
  await page.locator('#menuCode').click();
  await page.waitForTimeout(280);
  await shot('12-code');
  await page.locator('#askNo').click();
  await page.waitForTimeout(200);
  ok('שנים-עשר צילומי מסך נשמרו (' + shots.length + ')', shots.length === 12);
  ok('כל הצילומים קיימים על הדיסק',
     shots.every(n => fs.existsSync(path.join(SHOTS, n + '.png'))));

  await browser.close();
  store.srv.close();
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
