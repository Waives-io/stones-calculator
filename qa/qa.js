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
    const tot = document.querySelector('.total .big');
    return {
      rows, live,
      sum: Math.round(live.reduce((a,r) => a + r.hrs, 0) * 10) / 10,
      total: tot ? n(tot) : null,
      free: (document.querySelector('.total .free') || {}).textContent || ''
    };
  });
}
async function addTask(p, o){
  await p.locator('#btnNew').click();
  await p.waitForSelector('#sheet #fName');
  if(o.chip) await p.locator('#sheet .chip', {hasText: o.chip}).first().click();
  if(o.name){ await p.locator('#fName').fill(''); await p.locator('#fName').type(o.name, {delay:5}); }
  if(o.freq){
    for(let i=0; i<4; i++){
      const cur = (await p.locator('#fFreq').textContent()).trim();
      if(cur === o.freq) break;
      await p.locator('#fFreq').click();
    }
  }
  if(o.minutes !== undefined){
    const box = p.locator('#sheet input[aria-label="מספר דקות"]');
    await box.fill(''); await box.type(String(o.minutes), {delay:5});
  }
  if(o.auto) await p.locator('#sheet .chip', {hasText: o.auto}).first().click();
  await p.locator('#sheetSave').click();
  await p.waitForTimeout(150);
}

async function main(){
  const base = process.argv[2];
  let srv = null;
  const url = (base || ('http://localhost:' + PORT + '/')).split('#')[0];
  if(!base) srv = await serve();
  fs.mkdirSync(SHOTS, {recursive:true});

  const browser = await chromium.launch();
  const consoleErrors = [];
  const ctx = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const page = await ctx.newPage();
  page.on('console', m => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  const fresh = async p => {
    await p.goto(url);
    await p.evaluate(() => { try{ localStorage.clear(); }catch(e){} });
    await p.goto(url);
    await p.waitForTimeout(150);
  };
  await fresh(page);

  /* ---------------------------------------------------------- */
  section('1. המסך הראשון הוא רשימה');
  ok('רשימה ריקה מזמינה להוסיף',
     (await page.locator('.empty h3').textContent()).includes('ריקה'));
  ok('יש כפתור "משימה ראשונה"', await page.locator('#emptyAdd').isVisible());
  ok('יש כפתור דוגמה גם במצב ריק', await page.locator('#emptyDemo').isVisible());
  ok('כפתור "חדש" קיים בסרגל העליון', await page.locator('#btnNew').isVisible());
  const newBox = await page.locator('#btnNew').boundingBox();
  const titleBox = await page.locator('.top h1').boundingBox();
  ok('כפתור "חדש" יושב בצד שמאל, משמאל לכותרת',
     newBox.x < titleBox.x, JSON.stringify({newX:newBox.x, titleX:titleBox.x}));
  ok('סרגל תחתון עם שלושה מסכים',
     (await page.locator('nav.bar button').count()) === 3);
  ok('אין שורות עדיין', (await page.locator('.row').count()) === 0);

  /* ---------------------------------------------------------- */
  section('2. הוספה: הטופס הוא המחשבון');
  await page.locator('#btnNew').click();
  await page.waitForSelector('#sheet #fName');
  const n0 = numOf(await page.locator('#sheet .n').textContent());
  ok('הטופס נפתח עם 0', n0 === 0, String(n0));
  await page.locator('#sheet .chip', {hasText:'מיון קורות חיים'}).first().click();
  const n1 = numOf(await page.locator('#sheet .n').textContent());
  ok('לחיצה על משימה מוכנה מזיזה את המספר מיד', n1 > 0, String(n1));
  await page.locator('#sheet .chip', {hasText:'חצי (50%)'}).first().click();
  const n2 = numOf(await page.locator('#sheet .n').textContent());
  ok('לחיצה על אחוז אוטומציה מזיזה את המספר', n2 !== n1, n1 + ' → ' + n2);
  const freqBefore = (await page.locator('#fFreq').textContent()).trim();
  await page.locator('#fFreq').click();
  const freqAfter = (await page.locator('#fFreq').textContent()).trim();
  const n3 = numOf(await page.locator('#sheet .n').textContent());
  ok('התדירות היא כפתור בתוך השאלה ומשנה את המספר',
     freqBefore !== freqAfter && n3 !== n2, freqBefore + ' → ' + freqAfter);
  const qLabel = (await page.locator('#sheet .qlabel').first().textContent()).trim();
  ok('השאלה כוללת את המילים "כמה זמן היא לוקחת"', qLabel.includes('כמה זמן היא לוקחת'), qLabel);
  ok('סימן השאלה נשאר צמוד לשאלה', qLabel.endsWith('?'), qLabel);
  ok('אין שורת "לשינוי" נפרדת מתחת',
     !(await page.locator('#sheet').textContent()).includes('לשינוי'));
  await page.locator('#sheetClose').click();
  ok('סגירה בלי שמירה לא הוסיפה שורה', (await page.locator('.row').count()) === 0);

  /* ---------------------------------------------------------- */
  section('3. משימה חופשית שלא ברשימה המוכנה');
  await addTask(page, {name:'סידור תיקיות בשרת', minutes:40, freq:'פעם ביום', auto:'רוב (70%)'});
  ok('משימה שנכתבה ביד נכנסה לרשימה', (await page.locator('.row').count()) === 1);
  let L = await listNums(page);
  ok('השם נשמר כפי שנכתב', L.rows[0].name === 'סידור תיקיות בשרת', L.rows[0].name);
  // 40 דק׳ × 20 ימים × אדם אחד × 70% = 9.33
  ok('החישוב למשימה חופשית נכון', near(L.rows[0].hrs, 9.3), String(L.rows[0].hrs));

  /* ---------------------------------------------------------- */
  section('4. בדיקת חישוב מדויקת (20 ימים, 4.5 שבועות, משרה 180)');
  const calc = await page.evaluate(() => {
    const W = window.__waives;
    const mk = (minutes, freq, people, auto) =>
      (minutes/60) * (freq==='day'?W.DAYS_MONTH:freq==='week'?W.WEEKS_MONTH:freq==='month'?1:1/3) * people * auto;
    return {
      fte:W.FTE_MONTH, days:W.DAYS_MONTH, weeks:W.WEEKS_MONTH,
      a:mk(120,'day',1,0.7), b:mk(45,'day',4,0.9), c:mk(180,'week',1,0.5), d:mk(600,'quarter',1,0.7),
      words:[W.freeText(0.16), W.freeText(1.69), W.freeText(1), W.freeText(2), W.freeText(0)]
    };
  });
  ok('משרה מלאה = 180 שעות', calc.fte === 180, String(calc.fte));
  ok('חודש = 20 ימי עבודה', calc.days === 20, String(calc.days));
  ok('חודש = 4.5 שבועות', calc.weeks === 4.5, String(calc.weeks));
  ok('120 דק׳ ליום, אדם אחד, 70% = 28 שעות', near(calc.a, 28), String(calc.a));
  ok('45 דק׳ ליום, 4 אנשים, 90% = 54 שעות', near(calc.b, 54), String(calc.b));
  ok('180 דק׳ לשבוע, 50% = 6.75 שעות', near(calc.c, 6.75), String(calc.c));
  ok('600 דק׳ לרבעון, 70% = 2.33 שעות', near(calc.d, 2.333, 0.01), String(calc.d));

  /* ---------------------------------------------------------- */
  section('5. הרשימה חייבת להסתדר (קריאה מהמסך)');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(250);
  L = await listNums(page);
  ok('הדוגמה טענה 10 משימות', L.rows.length === 10, String(L.rows.length));
  ok('סכום השורות = הסה' + '״' + 'כ שעל המסך', L.sum === L.total, L.sum + ' ≠ ' + L.total);
  ok('הסה' + '״' + 'כ של הדוגמה הוא 303', L.total === 303, String(L.total));
  ok('השורה הגדולה ביותר היא 84 שעות',
     Math.max.apply(null, L.rows.map(r => r.hrs)) === 84);
  ok('הכותרת סופרת כמה בחישוב',
     (await page.locator('.cardhead .sub').textContent()).includes('10 מתוך 10'));

  /* ---------------------------------------------------------- */
  section('6. תיבת הסימון מוציאה ומכניסה לסכום');
  const before = L.total;
  const firstHrs = L.rows[0].hrs;
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(180);
  let L2 = await listNums(page);
  ok('הורדת סימון מורידה את הסכום', L2.total === before - firstHrs,
     before + ' - ' + firstHrs + ' ≠ ' + L2.total);
  ok('השורה נשארת על המסך', L2.rows.length === 10);
  ok('השורה מסומנת כלא-פעילה', L2.rows[0].on === false);
  ok('הסכום עדיין מסתדר עם מה שמסומן', L2.sum === L2.total, L2.sum + ' ≠ ' + L2.total);
  ok('הכותרת מעדכנת 9 מתוך 10',
     (await page.locator('.cardhead .sub').textContent()).includes('9 מתוך 10'));
  await page.locator('.row .tick').first().click();
  await page.waitForTimeout(180);
  L2 = await listNums(page);
  ok('החזרת הסימון מחזירה את הסכום', L2.total === before, String(L2.total));

  /* ---------------------------------------------------------- */
  section('7. צוותים: כמות האנשים יושבת רק שם');
  await page.locator('#btnNew').click();
  await page.waitForSelector('#sheet #fName');
  const sheetTxt = await page.locator('#sheet').textContent();
  const peopleFields = await page.locator('#sheet input[aria-label*="אנשים"]').count();
  await page.locator('#sheetClose').click();
  ok('בטופס הפריט אין שדה מספר אנשים', peopleFields === 0, String(peopleFields));
  ok('הטופס מפנה למסך צוותים', sheetTxt.includes('צוותים'), 'לא נמצאה הפניה');
  await page.locator('#navTeams').click();
  await page.waitForTimeout(200);
  ok('מסך הצוותים מציג שלושה צוותים', (await page.locator('.team').count()) === 3);
  const stepper = page.locator('.team').first().locator('.stepper input');
  const peopleBefore = Number(await stepper.inputValue());
  await page.locator('.team').first().locator('.stepper button').last().click();
  await page.waitForTimeout(200);
  ok('הוספת אדם מעדכנת את הצוות',
     Number(await stepper.inputValue()) === peopleBefore + 1,
     peopleBefore + ' → ' + (await stepper.inputValue()));
  await page.locator('#navList').click();
  await page.waitForTimeout(200);
  const L3 = await listNums(page);
  ok('הוספת אדם העלתה את הסכום ברשימה', L3.total > before, before + ' → ' + L3.total);
  ok('השורה מראה את מספר האנשים שהיא מוכפלת בו',
     L3.rows[0].meta.includes('×3 אנשים'), L3.rows[0].meta);
  await page.locator('#navTeams').click();
  await page.waitForTimeout(150);
  await page.locator('.team').first().locator('.stepper button').first().click();
  await page.waitForTimeout(200);
  await page.locator('#navList').click();
  await page.waitForTimeout(200);
  ok('הורדת אדם מחזירה את הסכום', (await listNums(page)).total === before);

  /* ---------------------------------------------------------- */
  section('8. שם צוות נכתב במלואו בלי לאבד פוקוס');
  await page.locator('#navTeams').click();
  await page.waitForTimeout(200);
  const tname = page.locator('.team input[aria-label="שם הצוות או התפקיד"]').first();
  await tname.fill('');
  await tname.type('רכזות גיוס וקליטה', {delay: 12});
  ok('שם צוות ארוך נכתב במלואו',
     (await tname.inputValue()) === 'רכזות גיוס וקליטה' &&
     await tname.evaluate(e => e === document.activeElement),
     await tname.inputValue());

  /* ---------------------------------------------------------- */
  section('9. עריכה ומחיקה של שורה');
  await page.locator('#navList').click();
  await page.waitForTimeout(200);
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheet #fName');
  ok('לחיצה על שורה פותחת אותה לעריכה',
     (await page.locator('#fName').inputValue()).length > 0);
  ok('בעריכה מופיע כפתור מחיקה', await page.locator('#sheetDelete').isVisible());
  await page.locator('#sheet .chip', {hasText:'חצי (50%)'}).first().click();
  await page.locator('#sheetSave').click();
  await page.waitForTimeout(200);
  const L4 = await listNums(page);
  ok('העריכה שינתה את השורה', L4.rows[0].meta.includes('50%'), L4.rows[0].meta);
  ok('העריכה שינתה את הסכום', L4.total < before, before + ' → ' + L4.total);
  await page.locator('.row .rowmain').first().click();
  await page.waitForSelector('#sheetDelete');
  await page.locator('#sheetDelete').click();
  await page.waitForTimeout(200);
  ok('המחיקה הורידה שורה', (await page.locator('.row').count()) === 9);
  ok('מוצע ביטול', await page.locator('#snackBtn').isVisible());
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(200);
  ok('הביטול החזיר את השורה', (await page.locator('.row').count()) === 10);

  /* ---------------------------------------------------------- */
  section('10. שמירה, רענון וקישור לתרחיש');
  await fresh(page);
  await addTask(page, {chip:'עדכון CRM'});
  const mine = (await listNums(page)).total;
  await page.reload();
  await page.waitForTimeout(250);
  ok('התרחיש שורד רענון', (await listNums(page)).total === mine, String(mine));
  const hashPart = await page.evaluate(() => window.__waives.shareUrl().split('#')[1]);
  ok('הקישור מכיל s=', hashPart.indexOf('s=') === 0, hashPart.slice(0,12));
  const ctxB = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const pageB = await ctxB.newPage();
  await pageB.goto(url + '#' + hashPart);
  await pageB.waitForTimeout(250);
  ok('הקישור נפתח עם אותו מספר', (await listNums(pageB)).total === mine);
  await ctxB.close();

  /* ---------------------------------------------------------- */
  section('11. שם עם אותיות לטיניות נקרא ונשמר נכון');
  await fresh(page);
  await addTask(page, {name:'עדכון CRM אחרי פגישות', minutes:45, auto:'רוב (70%)'});
  const round = await page.evaluate(() => {
    const W = window.__waives;
    const back = W.sanitize(W.unpack(JSON.parse(W.b64urlDecode(W.shareUrl().split('#s=')[1]))));
    return back.groups[0].tasks[0].name;
  });
  ok('שם עם עברית ולטינית חוזר זהה', round === 'עדכון CRM אחרי פגישות', round);
  const metaTxt = (await listNums(page)).rows[0].meta.trim();
  ok('הפירוט מתחיל בדקות ולא נגרר אל השם', /^45 דק/.test(metaTxt), metaTxt);

  /* ---------------------------------------------------------- */
  section('12. קישור עוין או שבור');
  const hostile = [
    ['קישור חתוך', 'eyJ2IjoyLCJnIjpb'],
    ['לא base64 בכלל', '!!!!'],
    ['דקות שליליות', enc({v:2,g:[{n:'צ',p:1,t:[{n:'רע',m:-500,f:0,a:2,o:1}]}]})],
    ['מיליארד אנשים', enc({v:2,g:[{n:'צ',p:1e9,t:[{n:'רע',m:60,f:0,a:2,o:1}]}]})],
    ['אוטומציה 99', enc({v:2,g:[{n:'צ',p:1,t:[{n:'רע',m:60,f:0,a:99,o:1}]}]})],
    ['תדירות לא מוכרת', enc({v:2,g:[{n:'צ',p:1,t:[{n:'רע',m:60,f:77,a:2,o:1}]}]})],
    ['הזרקת תגית', enc({v:2,g:[{n:'צ',p:1,t:[{n:'<img src=x onerror=alert(1)>',m:60,f:0,a:2,o:1}]}]})],
    ['תחום לא קיים', enc({v:2,g:[{n:'צ',p:1,t:[{n:'רע',m:60,f:0,a:2,o:1,dm:99}]}]})],
    ['קישור מהגרסה הישנה', enc({v:1,m:'talk',g:[{n:'צוות ישן',d:null,p:2,i:0,t:[{n:'משימה ישנה',m:60,f:0,a:2,r:1,s:null}]}]})]
  ];
  for(const pair of hostile){
    const label = pair[0], h = pair[1];
    const c = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(url + '#s=' + h);
    await p.waitForTimeout(250);
    const st = await p.evaluate(() => {
      const r = window.__waives.compute();
      return {
        total: r.totals.freedMonth,
        people: window.__waives.state.groups.map(g => g.people),
        autos: r.rows.map(x => x.auto),
        freqs: r.rows.map(x => x.freq),
        imgs: document.querySelectorAll('img').length,
        alive: !!document.querySelector('nav.bar')
      };
    });
    ok(label + ': הדף חי ולא נשבר', st.alive && errs.length === 0, errs.join('; '));
    ok(label + ': אין ערך מופרך',
       Number.isFinite(st.total) && st.total >= 0 &&
       st.people.every(x => x >= 1 && x <= 999) &&
       st.autos.every(a => [0.25,0.5,0.7,0.9].indexOf(a) !== -1) &&
       st.freqs.every(f => ['day','week','month','quarter'].indexOf(f) !== -1),
       JSON.stringify(st));
    ok(label + ': שום תגית לא הוזרקה', st.imgs === 0);
    await c.close();
  }
  const oldLink = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const pOld = await oldLink.newPage();
  await pOld.goto(url + '#s=' + enc({v:1,m:'talk',g:[{n:'צוות ישן',d:null,p:2,i:0,t:[{n:'משימה ישנה',m:60,f:0,a:2,r:1,s:null}]}]}));
  await pOld.waitForTimeout(250);
  const oldL = await listNums(pOld);
  ok('קישור מהגרסה הישנה נפתח עם המשימה שלו',
     oldL.rows.length === 1 && oldL.rows[0].name === 'משימה ישנה', JSON.stringify(oldL.rows));
  ok('משימה מקישור ישן נספרת בחישוב', oldL.rows[0].on === true);
  await oldLink.close();

  /* ---------------------------------------------------------- */
  section('13. קישור נכנס לא מוחק את התרחיש המקומי');
  await fresh(page);
  await addTask(page, {name:'התרחיש שלי', minutes:60, auto:'רוב (70%)'});
  const mineTotal = (await listNums(page)).total;
  const other = enc({v:2,g:[{n:'צוות אחר',p:4,t:[{n:'משימה מקישור',m:60,f:0,a:2,o:1}]}]});
  await page.evaluate(h => { location.hash = 's=' + h; }, other);
  await page.waitForTimeout(300);
  ok('קישור נכנס נטען גם בלשונית פתוחה',
     (await listNums(page)).rows[0].name === 'משימה מקישור');
  ok('מוצע לחזור לתרחיש שלי', await page.locator('#snackBtn').isVisible());
  await page.locator('#snackBtn').click();
  await page.waitForTimeout(250);
  ok('הביטול החזיר את התרחיש המקומי', (await listNums(page)).total === mineTotal);

  /* ---------------------------------------------------------- */
  section('14. אחסון חסום (גלישה פרטית)');
  const ctxP = await browser.newContext({viewport:{width:390, height:844}, locale:'he-IL'});
  await ctxP.addInitScript(() => {
    const boom = () => { throw new Error('denied'); };
    try{
      Object.defineProperty(window, 'localStorage', {
        configurable:true,
        get(){ return {getItem:boom, setItem:boom, removeItem:boom, clear:boom}; }
      });
    }catch(e){}
  });
  const pageP = await ctxP.newPage();
  const perr = [];
  pageP.on('pageerror', e => perr.push(e.message));
  await pageP.goto(url);
  await pageP.waitForTimeout(250);
  await pageP.locator('#emptyDemo').click();
  await pageP.waitForTimeout(300);
  ok('בלי אחסון הכול עדיין עובד',
     (await listNums(pageP)).total === 303 && perr.length === 0,
     perr.join('; ') || String((await listNums(pageP)).total));
  await ctxP.close();

  /* ---------------------------------------------------------- */
  section('15. הדשבורד');
  await fresh(page);
  await page.locator('#emptyDemo').click();
  await page.waitForTimeout(250);
  await page.locator('#navDash').click();
  await page.waitForTimeout(300);
  const dash = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#screenDash h3')].map(h => h.textContent);
    return {
      heads,
      people: document.querySelectorAll('#screenDash .posrow svg').length,
      rings: [...document.querySelectorAll('#screenDash .posrow text')].map(t => t.textContent),
      num: Number(document.querySelector('.dash-num').textContent.replace(/[^\d.]/g,'')),
      sub: document.querySelector('.dash-sub').textContent,
      bars: document.querySelectorAll('#screenDash .bar-item').length,
      cap: document.querySelector('#screenDash .poscap').textContent
    };
  });
  ok('הדשבורד מציג את אותו מספר', dash.num === 303, String(dash.num));
  ok('שעות בחודש ובשנה', dash.sub.indexOf('3,641') !== -1 && dash.sub.indexOf('שעות בשנה') !== -1, dash.sub);
  ok('יש בלוק "כמה משרה זה"', dash.heads.some(h => h.indexOf('כמה משרה') !== -1), dash.heads.join(' | '));
  ok('יש בלוק "איפה הזמן יושב"', dash.heads.some(h => h.indexOf('איפה הזמן') !== -1));
  ok('יש פילוח לפי צוות', dash.heads.some(h => h.indexOf('לפי צוות') !== -1));
  ok('יש את השאלה על הזמן', dash.heads.some(h => h.indexOf('מה הייתם עושים') !== -1));
  ok('משרה שלמה מצוירת כאדם, והשארית כגלגל',
     dash.people === 2 && dash.rings.length === 1 && dash.rings[0] === '69%',
     JSON.stringify({people:dash.people, rings:dash.rings}));
  ok('הכיתוב ליד האייקונים מסכים עם הגלגל',
     dash.cap.indexOf('משרה ועוד 69%') !== -1, dash.cap);
  ok('יש מדרג משימות ופילוח צוותים', dash.bars >= 8, String(dash.bars));
  ok('כפתורי שיתוף יושבים בדשבורד',
     await page.locator('#btnShare').isVisible() && await page.locator('#btnCopy').isVisible());
  const summary = await page.evaluate(() => window.__waives.summaryText());
  ok('הסיכום להעתקה נושא את אותו מספר', summary.indexOf('303') !== -1, summary.slice(0,80));

  /* ---------------------------------------------------------- */
  section('16. הניסוח — אחוזי משרה, לא שברים');
  ok('מתחת למשרה: אחוזים', calc.words[0] === '16% משרה פנוי למשימות חשובות אחרות', calc.words[0]);
  ok('מעל משרה: "משרה ועוד"', calc.words[1] === 'משרה ועוד 69% פנויים למשימות חשובות אחרות', calc.words[1]);
  ok('בדיוק משרה אחת', calc.words[2] === 'משרה פנויה למשימות חשובות אחרות', calc.words[2]);
  ok('בדיוק שתי משרות', calc.words[3] === '2 משרות פנויות למשימות חשובות אחרות', calc.words[3]);
  ok('אפס: עדיין משפט שלם', calc.words[4] === '0% משרה פנוי למשימות חשובות אחרות', calc.words[4]);
  await page.locator('#navList').click();
  await page.waitForTimeout(200);
  ok('השורה בעגלה מצמידה את המסגרת למספר',
     (await listNums(page)).free.indexOf('למשימות חשובות אחרות') !== -1,
     (await listNums(page)).free);

  /* ---------------------------------------------------------- */
  section('17. המסר — אין אבנים, אין ₪, אין מילות קיצוץ');
  const src = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const screenText = [];
  for(const s of ['#navList','#navDash','#navTeams']){
    await page.locator(s).click();
    await page.waitForTimeout(220);
    // innerText, not textContent: textContent would also scan the page's own
    // <script>, so this would be testing the source instead of the screen.
    screenText.push(await page.evaluate(() => document.body.innerText));
  }
  const all = screenText.join(' ');
  const banned = ['קיצוץ','פיטור','חיסכון בכוח אדם', SHEKEL].filter(w => all.indexOf(w) !== -1);
  ok('אין מילים אסורות על המסך', banned.length === 0, banned.join(', '));
  ok('אין מילים אסורות בקוד', !new RegExp(SHEKEL + '|קיצוץ|פיטור').test(src));
  ok('אין קוד שמצייר אבנים או הר',
     !/function mountain|mountain\(|stoneSvg|pebble|cairn/i.test(src));
  ok('אין מקטע "ההר" בשום מקום', all.indexOf('ההר') === -1 && src.indexOf('ההר') === -1);
  ok('המילה "אבנים" מופיעה פעם אחת בכל מסך — שם הכלי בלבד',
     screenText.every(t => (t.match(/אבנים/g) || []).length === 1),
     screenText.map(t => (t.match(/אבנים/g) || []).length).join(','));

  /* ---------------------------------------------------------- */
  section('18. RTL, נגישות ומיקוד');
  await page.locator('#navList').click();
  await page.waitForTimeout(200);
  const a11y = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll('.tick')];
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      ticksRole: ticks.every(t => t.getAttribute('role') === 'checkbox'),
      ticksLabel: ticks.every(t => (t.getAttribute('aria-label') || '').length > 3),
      navCurrent: document.getElementById('navList').getAttribute('aria-current'),
      bdi: document.querySelectorAll('.row .nm').length === document.querySelectorAll('.row bdi.nm').length,
      titled: document.title.length > 5
    };
  });
  ok('הדף מוגדר עברית ו-RTL', a11y.dir === 'rtl' && a11y.lang === 'he');
  ok('לכל תיבת סימון יש תפקיד ותווית', a11y.ticksRole && a11y.ticksLabel);
  ok('הסרגל התחתון מסמן איפה אנחנו', a11y.navCurrent === 'page');
  ok('שמות המשימות מבודדים ב-bdi', a11y.bdi);
  ok('לדף יש כותרת', a11y.titled);
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement.tagName);
  ok('ניווט במקלדת מגיע לאלמנט', focused === 'BUTTON' || focused === 'A' || focused === 'INPUT', focused);
  await page.locator('#btnNew').click();
  await page.waitForTimeout(200);
  ok('הטופס הוא dialog עם תווית',
     (await page.locator('#sheet').getAttribute('role')) === 'dialog' &&
     !!(await page.locator('#sheet').getAttribute('aria-labelledby')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape סוגר את הטופס', await page.locator('#scrim').isHidden());

  /* ---------------------------------------------------------- */
  section('19. אין גלישה אופקית');
  for(const trio of [[320,700,'320'],[390,844,'390'],[768,1000,'768'],[1280,900,'1280']]){
    const c = await browser.newContext({viewport:{width:trio[0], height:trio[1]}, locale:'he-IL'});
    const p = await c.newPage();
    await p.goto(url);
    await p.evaluate(() => { try{ localStorage.clear(); }catch(e){} });
    await p.goto(url);
    await p.locator('#emptyDemo').click();
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => {
      const d = document.documentElement;
      const wide = [];
      document.querySelectorAll('*').forEach(e => {
        const r = e.getBoundingClientRect();
        if(r.width > 0 && (r.right > d.clientWidth + 1 || r.left < -1))
          wide.push((e.id || e.className || e.tagName) + '');
      });
      return {scroll: d.scrollWidth, client: d.clientWidth, wide: wide.slice(0,4)};
    });
    ok('אין גלישה אופקית ברוחב ' + trio[2] + 'px',
       over.scroll <= over.client + 1 && over.wide.length === 0, JSON.stringify(over));
    await c.close();
  }

  /* ---------------------------------------------------------- */
  section('20. צילומי מסך');
  const shot = async (name, w, h, fn) => {
    const c = await browser.newContext({viewport:{width:w, height:h}, locale:'he-IL', deviceScaleFactor:2});
    const p = await c.newPage();
    await p.goto(url);
    await p.evaluate(() => { try{ localStorage.clear(); }catch(e){} });
    await p.goto(url);
    await p.waitForTimeout(300);
    await fn(p);
    await p.waitForTimeout(400);
    await p.evaluate(() => { const s = document.getElementById('snack'); if(s) s.hidden = true; });
    await p.screenshot({path: path.join(SHOTS, name + '.png'), fullPage:true});
    await c.close();
  };
  const demoThen = extra => async p => {
    await p.locator('#emptyDemo').click();
    await p.waitForTimeout(300);
    if(extra) await extra(p);
  };
  for(const trio of [['mobile',390,844],['desktop',1280,900]]){
    const tag = trio[0], w = trio[1], h = trio[2];
    await shot('empty-' + tag, w, h, async () => {});
    await shot('list-' + tag, w, h, demoThen(null));
    await shot('sheet-' + tag, w, h, demoThen(async p => {
      await p.locator('#btnNew').click();
      await p.waitForSelector('#sheet #fName');
      await p.locator('#sheet .chip', {hasText:'עדכון CRM'}).first().click();
      await p.waitForTimeout(250);
    }));
    await shot('dash-' + tag, w, h, demoThen(async p => {
      await p.locator('#navDash').click(); await p.waitForTimeout(300);
    }));
    await shot('teams-' + tag, w, h, demoThen(async p => {
      await p.locator('#navTeams').click(); await p.waitForTimeout(300);
    }));
  }
  const wanted = [];
  for(const tag of ['mobile','desktop'])
    for(const n of ['empty','list','sheet','dash','teams']) wanted.push(n + '-' + tag + '.png');
  const missing = wanted.filter(f => !fs.existsSync(path.join(SHOTS, f)));
  ok('עשרת צילומי המסך נוצרו', missing.length === 0, missing.join(', '));
  ok('אין שגיאות קונסולה בכל הריצה', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

  await ctx.close();
  await browser.close();
  if(srv) srv.close();

  console.log('\n================================');
  console.log('עברו: ' + pass + '   נכשלו: ' + fail);
  if(fail){ console.log('\nכשלים:'); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
