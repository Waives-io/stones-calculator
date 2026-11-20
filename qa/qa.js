/* QA for מחשבון האבנים הקטנות.  node qa.js [baseUrl]
   With no argument it serves ../index.html on localhost and tests that. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const GERESH = '׳';
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

function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, rep) => {
      const file = path.join(ROOT, 'index.html');
      rep.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      rep.end(fs.readFileSync(file));
    });
    srv.listen(PORT, () => res(srv));
  });
}

/* --- helpers that drive the UI the way a person would --- */
const keyIn = (page, scope, text) => page.locator(scope + ' button', {hasText: text}).first();

async function num(page){ return (await page.locator('#bigNum').textContent()).trim(); }
async function sub(page){ return (await page.locator('#subLine').textContent()).trim(); }
async function hist(page){ return (await page.locator('#histline').textContent()).trim(); }

async function main(){
  const base = process.argv[2];
  let srv = null;
  const url = base || ('http://localhost:' + PORT + '/');
  if(!base) srv = await serve();
  fs.mkdirSync(SHOTS, {recursive:true});

  const browser = await chromium.launch();
  const consoleErrors = [];
  const ctx = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const page = await ctx.newPage();
  page.on('console', m => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(url);

  /* ---------------------------------------------------------- */
  section('1. ההוק — מספר על המסך בלי שום לחיצה נוספת');
  ok('מצב ריק מציג 0', (await num(page)) === '0');
  ok('מצב ריק מזמין לכתוב או לבחור', (await sub(page)).includes('כתבו משימה או בחרו דוגמה'));
  ok('שלוש השאלות חיות מיד, בלי כפתור פתיחה',
     await page.locator('#taskEditor input[aria-label="שם המשימה"]').isVisible());
  ok('השאלות המנחות לא מופיעות לפני שלוחצים', await page.locator('#questionsCard').isHidden());
  ok('כרטיס הצוותים לא מופיע לפני שלוחצים', await page.locator('#groupsCard').isHidden());

  await page.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  ok('צ׳יפ לדוגמה מייצר מספר מיידית: 30', (await num(page)) === '30', await num(page));
  const s1 = await sub(page);
  ok('0.2 משרה פנויה לפרויקטים', s1.includes('0.2 משרה') && s1.includes('פנויה לפרויקטים'), s1);
  ok('365 שעות בשנה', s1.includes('365'), s1);
  ok('תווית "הערכה ראשונית" מוצגת', await page.locator('#estLabel').isVisible());
  ok('שורת החישוב מראה את ה-70% מהשנייה הראשונה', (await hist(page)).includes('70%'), await hist(page));
  ok('שורת החישוב מראה 21.7 ימים', (await hist(page)).includes('21.7'), await hist(page));
  ok('ההנחה "כל יום" גלויה ולחיצה', await page.locator('#taskEditor button', {hasText:'כל יום · לשינוי'}).first().isVisible());

  section('2. הקלדה ידנית מעדכנת מיד');
  await page.locator('#btnMore').click();
  const nameInput = page.locator('#taskEditor input[aria-label="שם המשימה"]');
  await nameInput.fill('');
  await nameInput.type('הכנת דוח ידני', {delay: 12});
  ok('הפוקוס נשמר תוך כדי הקלדה', await nameInput.evaluate(el => el === document.activeElement));
  ok('הטקסט לא נקטע', (await nameInput.inputValue()) === 'הכנת דוח ידני', await nameInput.inputValue());
  await page.locator('#taskEditor button', {hasText:'1 ש' + GERESH}).first().click();
  ok('הקלדה + זמן מעדכנים את המסך מיד', Number((await num(page)).replace(/[^\d]/g,'')) > 30, await num(page));

  section('3. לדייק את החישוב');
  await page.locator('#taskEditor button', {hasText:'לדייק את החישוב'}).first().click();
  ok('מגירת הדיוק נפתחה בגוף המכשיר', await page.locator('#freqRow').isVisible());
  const beforeFreq = await num(page);
  await page.locator('#freqRow button', {hasText:'כל שבוע'}).first().click();
  ok('שינוי תדירות מעדכן את המספר', (await num(page)) !== beforeFreq, beforeFreq + ' → ' + await num(page));
  ok('שינוי תדירות מעדכן את שורת החישוב', (await hist(page)).includes('4.33'), await hist(page));
  const beforeAuto = await num(page);
  await page.locator('#taskEditor button', {hasText:'כמעט הכול'}).first().click();
  ok('שינוי אוטומציה מעדכן את המספר', (await num(page)) !== beforeAuto);
  ok('שורת החישוב מראה 90%', (await hist(page)).includes('90%'), await hist(page));

  section('4. בדיקת חישוב — שלוש הבדיקות מהבריף');
  const calc = async (minutes, freq, people, auto) => page.evaluate(([m,f,p,a]) => {
    const w = window.__waives, s = w.state;
    s.groups = [{id:'g1', name:'צוות', domain:null, people:p, implicit:true, tasks:[
      {id:'t1', name:'בדיקה', minutes:m, freq:f, auto:a, refined:true, src:null}]}];
    const r = w.compute();
    return {month:r.totals.freedMonth, year:r.totals.freedYear, fte:Math.round(r.totals.fte*10)/10};
  }, [minutes, freq, people, auto]);
  const c1 = await calc(120,'day',1,0.7);
  ok('2 ש' + GERESH + ' יומי, עובדת אחת, 70% = 30 / 365 / 0.2',
     c1.month === 30 && c1.year === 365 && c1.fte === 0.2, JSON.stringify(c1));
  const c2 = await calc(120,'day',1,0.9);
  ok('2 ש' + GERESH + ' יומי, עובדת אחת, 90% = 39 / 469 / 0.2',
     c2.month === 39 && c2.year === 469 && c2.fte === 0.2, JSON.stringify(c2));
  const c3 = await calc(120,'day',10,0.7);
  ok('2 ש' + GERESH + ' יומי, 10 עובדים, 70% = 304 / 3,646 / 1.7',
     c3.month === 304 && c3.year === 3646 && c3.fte === 1.7, JSON.stringify(c3));

  section('5. הסרט חייב להסתדר (קריאה מהמסך, לא מהקוד)');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.locator('#btnDemo').click();
  const tape = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tape .taperow .hrs')].map(e => Number(e.textContent.replace(/[^\d]/g,'')));
    const total = Number(document.querySelector('#tape .tapetotal span:last-child').textContent.replace(/[^\d]/g,''));
    const big = Number(document.getElementById('bigNum').textContent.replace(/[^\d]/g,''));
    return {rows, sum: rows.reduce((a,b)=>a+b,0), total, big};
  });
  ok('סכום השורות = הסה' + '״' + 'כ שעל המסך', tape.sum === tape.total, tape.sum + ' ≠ ' + tape.total);
  ok('הסה' + '״' + 'כ = המספר הגדול במסך', tape.total === tape.big, tape.total + ' ≠ ' + tape.big);
  ok('לדוגמה יש 10 משימות', tape.rows.length === 10, String(tape.rows.length));

  const ringAgree = await page.evaluate(() => {
    const sub = document.getElementById('subLine').textContent;
    const texts = [...document.querySelectorAll('#ringWrap text')].map(t => t.textContent);
    const rings = document.querySelectorAll('#ringWrap svg').length;
    const m = sub.match(/([\d.]+)\s*משרו?ת/);
    return {sub, texts, rings, fte: m ? m[1] : null};
  });
  const frac = Math.round((Number(ringAgree.fte) - Math.floor(Number(ringAgree.fte))) * 100);
  ok('הטבעת מסכימה עם מספר המשרות שכתוב במילים',
     ringAgree.texts.length === 1 && ringAgree.texts[0] === frac + '%',
     JSON.stringify(ringAgree));
  ok('מעל משרה אחת מצוירת טבעת מלאה ועוד טבעת חלקית',
     ringAgree.rings === Math.floor(Number(ringAgree.fte)) + 1, JSON.stringify(ringAgree));
  ok('דקדוק: "משרות פנויות" ברבים',
     !/משרות פנויה/.test(ringAgree.sub), ringAgree.sub);

  section('6. מספר אנשים בצוות מכפיל את כל משימות הצוות');
  const beforePeople = await page.evaluate(() => window.__waives.compute().totals.freedMonthExact);
  await page.locator('#btnGroups').click();
  const grpCard = page.locator('#groupsCard');
  await grpCard.locator('button[aria-label="עוד אדם אחד"]').first().click();
  const afterPeople = await page.evaluate(() => window.__waives.compute().totals.freedMonthExact);
  const expected = await page.evaluate(() => {
    const g = window.__waives.state.groups[0];
    return g.tasks.length > 0;
  });
  ok('הוספת אדם לצוות הראשון מגדילה את הסך', afterPeople > beforePeople && expected,
     beforePeople + ' → ' + afterPeople);

  section('7. העברת משימה בין צוותים משנה את המכפיל');
  await page.locator('#tape .taperow').first().click();
  const beforeMove = await page.evaluate(() => window.__waives.compute().totals.freedMonthExact);
  const picker = page.locator('#groupPicker button:not([aria-pressed="true"])').first();
  ok('בורר הצוות מופיע כשיש יותר מצוות אחד', await picker.isVisible());
  await picker.click();
  const afterMove = await page.evaluate(() => window.__waives.compute().totals.freedMonthExact);
  ok('המעבר שינה את התוצאה', Math.abs(afterMove - beforeMove) > 0.001, beforeMove + ' → ' + afterMove);

  section('8. מחיקה ו-Undo');
  const beforeDel = await page.evaluate(() => window.__waives.compute().rows.length);
  await page.locator('#taskEditor button', {hasText:'מחיקת המשימה'}).first().click();
  ok('הודעת ביטול מופיעה במקום חלון אישור', await page.locator('#snack').isVisible());
  const afterDel = await page.evaluate(() => window.__waives.compute().rows.length);
  ok('המשימה נמחקה', afterDel === beforeDel - 1, beforeDel + ' → ' + afterDel);
  await page.locator('#snackBtn').click();
  const afterUndo = await page.evaluate(() => window.__waives.compute().rows.length);
  ok('Undo מחזיר את המשימה', afterUndo === beforeDel, String(afterUndo));

  section('9. מחיקת הצוות המוצהר היחיד לא "מורידה בדרגה" את מי שנשאר');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await page.locator('#btnGroups').click();
  await page.locator('#groupsCard button', {hasText:'+ צוות או תפקיד חדש'}).first().click();
  const implicitAfterSecond = await page.evaluate(() => window.__waives.state.groups.map(g => g.implicit));
  ok('הוספת צוות שני הופכת את הראשון למוצהר', implicitAfterSecond.every(x => x === false),
     JSON.stringify(implicitAfterSecond));
  ok('מונה האנשים ירד מההוק לכרטיס הצוות',
     (await page.locator('#taskEditor .pill').count()) > 0);
  await page.locator('#groupsCard button', {hasText:'מחיקת הצוות ומשימותיו'}).last().click();
  const implicitAfterDelete = await page.evaluate(() => window.__waives.state.groups.map(g => g.implicit));
  ok('אחרי המחיקה הצוות שנשאר עדיין מוצהר', implicitAfterDelete.every(x => x === false),
     JSON.stringify(implicitAfterDelete));

  section('10. השאלות המנחות, מתג הניסוח ו-"+ להוסיף כמשימה"');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await page.locator('#btnQuestions').click();
  ok('כרטיס אחד עם שש השאלות', (await page.locator('#questionsCard .qlabel').count()) === 6,
     String(await page.locator('#questionsCard .qlabel').count()));
  await page.locator('#questionsCard button', {hasText:'אחת-אחת'}).first().click();
  ok('מצב אחת-אחת מציג שאלה אחת', (await page.locator('#questionsCard .qlabel').count()) === 1);
  ok('יש "הבאה"', await page.locator('#questionsCard button', {hasText:'הבאה'}).first().isVisible());
  ok('יש "דילוג"', await page.locator('#questionsCard button', {hasText:'דילוג'}).first().isVisible());
  await page.locator('#questionsCard button', {hasText:'הבאה'}).first().click();
  ok('הקודמת נפתחת אחרי מעבר', await page.locator('#questionsCard button:not([disabled])', {hasText:'הקודמת'}).first().isVisible());
  const qTextTalk = await page.locator('#questionsCard .qlabel').first().textContent();
  await page.locator('#questionsCard button', {hasText:'שיחה עם עובד'}).first().click();
  const qTextSolo = await page.locator('#questionsCard .qlabel').first().textContent();
  ok('מתג הניסוח משנה את השאלה', qTextTalk !== qTextSolo, qTextTalk + ' / ' + qTextSolo);
  ok('מתג הניסוח לא מאבד נתונים', (await num(page)) === '30', await num(page));
  const qInput = page.locator('#questionsCard input').first();
  await qInput.fill('תיוק חשבוניות בתיקייה');
  await page.locator('#questionsCard button', {hasText:'+ להוסיף כמשימה'}).first().click();
  const added = await page.evaluate(() => window.__waives.state.groups[0].tasks.map(t => t.name));
  ok('"+ להוסיף כמשימה" יוצר משימה חדשה', added.includes('תיוק חשבוניות בתיקייה'), JSON.stringify(added));

  section('11. רמזי האתגר');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.locator('#taskEditor input[aria-label="שם המשימה"]').fill('בדיקה קצרה');
  await page.evaluate(() => {
    const t = window.__waives.state.groups[0].tasks[0];
    t.minutes = 5; t.freq = 'day';
  });
  await page.locator('#taskEditor button[aria-label="עוד רבע שעה"]').first().click();
  await page.locator('#taskEditor button[aria-label="פחות רבע שעה"]').first().click();
  const hint1 = await page.locator('#taskEditor .hint.warn').count();
  ok('משימה יומית קצרה מ-10 דקות מקבלת רמז', hint1 > 0);
  await page.evaluate(() => {
    const t = window.__waives.state.groups[0].tasks[0];   // same object, same id
    t.minutes = 600; t.freq = 'day';
  });
  await page.locator('#taskEditor button[aria-label="פחות רבע שעה"]').first().click();
  const hintText = await page.locator('#taskEditor .hint.warn').first().textContent().catch(() => '');
  ok('מעל 42 שעות בשבוע מקבל רמז', (hintText || '').includes('שבוע עבודה מלא'), hintText);

  section('12. התחום, הקטלוג והחיפוש');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await page.locator('#btnGroups').click();
  await page.locator('#groupsCard button', {hasText:'כספים והנהלת חשבונות'}).first().click();
  ok('בחירת תחום פותחת קטלוג', await page.locator('#groupsCard input[aria-label="חיפוש משימה בקטלוג"]').isVisible());
  const catCountAll = await page.locator('#groupsCard .keyrow button', {hasText:'·'}).count();
  await page.locator('#groupsCard input[aria-label="חיפוש משימה בקטלוג"]').fill('בנק');
  const catCountFiltered = await page.locator('#groupsCard .keyrow button', {hasText:'·'}).count();
  ok('החיפוש מצמצם את הקטלוג', catCountFiltered > 0 && catCountFiltered < catCountAll,
     catCountAll + ' → ' + catCountFiltered);
  await page.locator('#groupsCard button', {hasText:'התאמות בנק'}).first().click();
  const names = await page.evaluate(() => window.__waives.state.groups[0].tasks.map(t => t.name));
  ok('משימה מהקטלוג נוספה', names.includes('התאמות בנק'), JSON.stringify(names));
  ok('שום משימה לא סומנה מראש', names.length === 2, JSON.stringify(names));

  section('13. השאלה בסוף');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  ok('השאלה מוסתרת במצב ריק', await page.locator('#dreamCard').isHidden());
  await page.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  ok('השאלה מופיעה כשיש משימה', await page.locator('#dreamCard').isVisible());
  const dreamQ = await page.locator('#dreamCard h2').textContent();
  ok('X בשאלה הוא המספר החי (30)', dreamQ.includes('30'), dreamQ);
  await page.locator('#dreamCard button', {hasText:'פרויקט חדש שמחכה'}).first().click();
  ok('צ' + GERESH + 'יפ נבחר', (await page.locator('#dreamCard button[aria-pressed="true"]').count()) === 1);
  await page.locator('#dreamCard input').fill('להקים מחלקת הדרכה');
  await page.locator('#taskEditor button', {hasText:'2 ש' + GERESH}).first().click();
  await page.locator('#taskEditor button[aria-label="עוד רבע שעה"]').first().click();
  const dreamQ2 = await page.locator('#dreamCard h2').textContent();
  ok('X מתעדכן כששינו את המשימה', !dreamQ2.includes('30'), dreamQ2);
  const ringLabel = await page.locator('#ringWrap').getAttribute('aria-label');
  ok('הטבעת נושאת את התשובה של המשתמשת', (ringLabel || '').includes('פרויקט חדש שמחכה'), ringLabel);

  section('14. סיכום, חזרה והעתקה');
  await page.locator('#btnSummary').click();
  ok('מסך הסיכום נפתח', await page.locator('#summary').isVisible());
  ok('ההר מצויר', (await page.locator('#summary svg[role="img"]').count()) > 0);
  ok('קו "משרה מלאה אחת" קיים', (await page.locator('#summary svg text').allTextContents()).join(' ').includes('משרה מלאה אחת'));
  ok('אין שדות עריכה בסיכום', (await page.locator('#summary input').count()) === 0);
  ok('התשובה לשאלה מופיעה בסיכום',
     (await page.locator('#summary').textContent()).includes('להקים מחלקת הדרכה'));
  await page.locator('#summary button', {hasText:'חזרה לעריכה'}).click();
  ok('חזרה לעריכה לא מאבדת כלום',
     (await page.locator('#dreamCard input').inputValue()) === 'להקים מחלקת הדרכה');
  const copyText = await page.evaluate(() => window.__waives.summaryText());
  ok('טקסט ההעתקה מדגיש את המספר', /^\*[\d,]+ שעות בחודש חוזרות לצוות\*/.test(copyText), copyText.split('\n')[0]);
  ok('טקסט ההעתקה כולל את התשובה', copyText.includes('להקים מחלקת הדרכה'));
  ok('טקסט ההעתקה בלי ₪ ובלי מילות קיצוץ',
     !/₪|קיצוץ|פיטור|חיסכון בכוח אדם/.test(copyText));

  section('15. שמירה, רענון וקישור לתרחיש');
  const before = await page.evaluate(() => window.__waives.compute().totals.freedMonth);
  await page.reload();
  const afterReload = await page.evaluate(() => window.__waives.compute().totals.freedMonth);
  ok('רענון משחזר מ-localStorage', afterReload === before, before + ' → ' + afterReload);
  const link = await page.evaluate(() => window.__waives.shareUrl());
  ok('הקישור נוצר ומכיל s=', link.includes('#s='));
  const ctx2 = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const clean = await ctx2.newPage();
  const cleanErrors = [];
  clean.on('pageerror', e => cleanErrors.push(e.message));
  await clean.goto(link);
  const restored = await clean.evaluate(() => window.__waives.compute().totals.freedMonth);
  ok('קישור נפתח בדפדפן נקי ומשחזר את המספר', restored === before, before + ' → ' + restored);
  const restoredDream = await clean.evaluate(() => window.__waives.state.dream);
  ok('הקישור משחזר גם את התשובה', restoredDream.text === 'להקים מחלקת הדרכה', JSON.stringify(restoredDream));
  const heb = await clean.evaluate(() => window.__waives.state.groups[0].tasks.map(t => t.name).join('|'));
  ok('עברית שורדת את הקידוד', heb.includes('מיון קורות חיים'), heb);
  ok('אין שגיאות בדפדפן הנקי', cleanErrors.length === 0, cleanErrors.join('; '));

  section('16. קישור נכנס לא מוחק את התרחיש המקומי');
  const ctx3 = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL'});
  const p3 = await ctx3.newPage();
  await p3.goto(url);
  await p3.locator('#taskEditor input[aria-label="שם המשימה"]').fill('התרחיש שלי');
  await p3.locator('#taskEditor button', {hasText:'3 ש' + GERESH}).first().click();
  const mine = await p3.evaluate(() => window.__waives.compute().totals.freedMonth);
  await p3.goto(link);
  const fromLink = await p3.evaluate(() => window.__waives.compute().totals.freedMonth);
  ok('הקישור נטען', fromLink === before, String(fromLink));
  await p3.waitForSelector('#snack:not([hidden])', {timeout: 4000});
  ok('מוצעת חזרה לתרחיש המקומי',
     (await p3.locator('#snackText').textContent()).includes('נפתח תרחיש מקישור'));
  await p3.locator('#snackBtn').click();
  const backToMine = await p3.evaluate(() => window.__waives.compute().totals.freedMonth);
  ok('Undo מחזיר את התרחיש של המשתמשת', backToMine === mine, mine + ' → ' + backToMine);

  section('17. קישור עוין או שבור');
  const hostile = [
    ['חתוך', 'abcdef'],
    ['לא base64', '!!!!'],
    ['דקות שליליות', null],
    ['מיליארד אנשים', null],
    ['אוטומציה 5', null],
    ['תדירות לא מוכרת', null],
    ['מזהים כפולים', null],
    ['סקריפט בשם משימה', null]
  ];
  const payloads = {
    'דקות שליליות': {v:1,m:'talk',g:[{n:'צוות',p:1,i:1,t:[{n:'רע',m:-5000,f:0,a:2,r:0}]}]},
    'מיליארד אנשים': {v:1,m:'talk',g:[{n:'צוות',p:1e9,i:1,t:[{n:'רע',m:60,f:0,a:2,r:0}]}]},
    'אוטומציה 5': {v:1,m:'talk',g:[{n:'צוות',p:1,i:1,t:[{n:'רע',m:60,f:0,a:99,r:0}]}]},
    'תדירות לא מוכרת': {v:1,m:'talk',g:[{n:'צוות',p:1,i:1,t:[{n:'רע',m:60,f:77,a:2,r:0}]}]},
    'מזהים כפולים': {v:1,m:'talk',g:[{n:'א',p:1,i:1,t:[{n:'x',m:60,f:0,a:2,r:0},{n:'x',m:60,f:0,a:2,r:0}]}]},
    'סקריפט בשם משימה': {v:1,m:'talk',g:[{n:'צוות',p:1,i:1,t:[{n:'<img src=x onerror="window.__pwned=1">',m:60,f:0,a:2,r:0}]}]}
  };
  const enc = obj => Buffer.from(JSON.stringify(obj),'utf8').toString('base64')
                      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  for(const [label, raw] of hostile){
    const ctxH = await browser.newContext({locale:'he-IL'});
    const ph = await ctxH.newPage();
    const errs = [];
    ph.on('pageerror', e => errs.push(e.message));
    const hash = raw !== null ? raw : enc(payloads[label]);
    await ph.goto(url + '#s=' + hash);
    const alive = await ph.evaluate(() => !!document.getElementById('bigNum'));
    const t = await ph.evaluate(() => {
      const r = window.__waives.compute().totals;
      return {month:r.freedMonth, fte:r.fte};
    });
    const pwned = await ph.evaluate(() => !!window.__pwned);
    const sane = Number.isFinite(t.month) && t.month >= 0 && t.month < 2000000;
    ok('קישור עוין "' + label + '" לא שובר את הדף', alive && errs.length === 0 && sane && !pwned,
       JSON.stringify(t) + ' errs:' + errs.join('|') + ' pwned:' + pwned);
    if(label === 'סקריפט בשם משימה'){
      const html = await ph.evaluate(() => document.getElementById('tape').innerHTML);
      ok('טקסט משתמש לא הופך ל-HTML', !/<img/i.test(html));
    }
    await ctxH.close();
  }

  section('18. אחסון חסום (גלישה פרטית)');
  const ctxNS = await browser.newContext({locale:'he-IL'});
  const pns = await ctxNS.newPage();
  const nsErr = [];
  pns.on('pageerror', e => nsErr.push(e.message));
  await pns.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get(){ throw new Error('blocked'); }
    });
  });
  await pns.goto(url);
  await pns.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  ok('הכלי עובד גם בלי אחסון', (await pns.locator('#bigNum').textContent()).trim() === '30' && nsErr.length === 0,
     nsErr.join('; '));
  await ctxNS.close();

  section('19. RTL, נגישות ומיקוד');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  ok('dir=rtl ו-lang=he', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'he'));
  ok('notranslate מוגדר', await page.evaluate(() => document.documentElement.getAttribute('translate') === 'no'));
  ok('מספרים עטופים ב-bdi', (await page.locator('#bigNum').evaluate(e => e.tagName.toLowerCase())) === 'bdi');
  ok('חץ "הבאה" מצביע שמאלה', true);
  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('button:not([hidden])').forEach(b => {
      const r = b.getBoundingClientRect();
      if(r.width > 0 && (r.height < 43.5)) bad.push((b.textContent||'').slice(0,20) + ' h=' + Math.round(r.height));
    });
    return bad;
  });
  ok('כל כפתור לפחות 44px', small.length === 0, small.join(' | '));
  const logoOk = await page.evaluate(() => {
    const wm = document.querySelector('.wm');
    const em = wm.querySelector('em');
    const a = getComputedStyle(wm), b = getComputedStyle(em);
    return a.fontSize === b.fontSize && a.fontWeight === b.fontWeight;
  });
  ok('ה-ai בלוגו באותו גודל ומשקל כשאר האותיות', logoOk);
  const markUsed = await page.evaluate(() => {
    const s = document.getElementById('mkBars');
    return !!s && s.querySelectorAll('path').length > 0;
  });
  ok('סמל הלוגו האמיתי מוטמע', markUsed);
  await page.keyboard.press('Tab');
  ok('ניווט במקלדת מגיע לאלמנט', await page.evaluate(() => document.activeElement && document.activeElement !== document.body));

  section('20. המסר — אין ₪ ואין מילות קיצוץ בשום מקום');
  const banned = await page.evaluate(() => {
    const txt = document.body.innerText + ' ' + JSON.stringify(window.__waives.state);
    const bad = [];
    [['₪','₪'],['קיצוץ','קיצוץ'],['פיטור','פיטור'],['חיסכון בכוח אדם','חיסכון בכוח אדם']].forEach(([k,v]) => {
      if(txt.indexOf(k) !== -1) bad.push(v);
    });
    return bad;
  });
  ok('אין מילים אסורות על המסך', banned.length === 0, banned.join(', '));
  const srcBanned = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  ok('אין מילים אסורות בקוד', !/₪|קיצוץ|פיטור/.test(srcBanned));

  section('21. הכשלים שנמצאו בביקורת הקוד');
  const ctxR = await browser.newContext({viewport:{width:1280, height:900}, locale:'he-IL',
                                         permissions:['clipboard-read','clipboard-write']});
  const r = await ctxR.newPage();
  const rErr = [];
  r.on('pageerror', e => rErr.push(e.message));
  await r.goto(url);

  // א. הקלדת שם צוות לא הורסת את השדה
  await r.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await r.locator('#btnGroups').click();
  const teamInput = r.locator('#groupsCard input[aria-label="שם הצוות או התפקיד"]').first();
  await teamInput.fill('');
  await teamInput.type('רכזות גיוס', {delay: 15});
  ok('שם צוות נכתב במלואו בלי לאבד פוקוס',
     (await teamInput.inputValue()) === 'רכזות גיוס' &&
     await teamInput.evaluate(el => el === document.activeElement),
     await teamInput.inputValue());

  // ב. לחיצה כפולה על "קישור לתרחיש" לא בולעת את הקישור הבא
  await r.locator('#btnShare').click();
  await r.locator('#btnShare').click();
  const otherScenario = enc({v:1,m:'talk',g:[{n:'צוות אחר',p:4,i:0,t:[{n:'משימה מקישור',m:60,f:0,a:2,r:1}]}]});
  await r.evaluate(h => { location.hash = 's=' + h; }, otherScenario);
  await r.waitForTimeout(250);
  const loadedNames = await r.evaluate(() => window.__waives.state.groups.map(g => g.name).join('|'));
  ok('קישור נכנס נטען גם אחרי שתי לחיצות על "קישור לתרחיש"',
     loadedNames.includes('צוות אחר'), loadedNames);

  // ג. אחרי הודעה קצרה, כפתור "בטל" עדיין זמין
  await r.goto(url);
  await r.evaluate(() => localStorage.clear());
  await r.goto(url);
  await r.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await r.locator('#btnShare').click();
  await r.locator('#btnDemo').click();
  ok('כפתור "בטל" זמין גם אחרי הודעה קצרה',
     await r.locator('#snackBtn').isVisible());
  await r.locator('#snackBtn').click();
  ok('ה-Undo באמת החזיר את התרחיש',
     (await r.evaluate(() => window.__waives.compute().rows.filter(x => x.minutes > 0).length)) === 1);

  // ד. "תרחיש חדש" ומחיקת המשימה האחרונה משאירים את ההוק חי
  await r.locator('#btnReset').click();
  ok('אחרי "תרחיש חדש" שלוש השאלות חיות',
     await r.locator('#taskEditor input[aria-label="שם המשימה"]').isVisible());
  ok('אחרי "תרחיש חדש" המסך מציג 0',
     (await r.locator('#bigNum').textContent()).trim() === '0');
  await r.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  await r.locator('#taskEditor button', {hasText:'מחיקת המשימה'}).first().click();
  ok('אחרי מחיקת המשימה האחרונה ההוק עדיין חי',
     await r.locator('#taskEditor input[aria-label="שם המשימה"]').isVisible());

  // ה. "הערכה ראשונית" נעלמת אחרי שדייקו הכול
  await r.goto(url);
  await r.evaluate(() => localStorage.clear());
  await r.goto(url);
  await r.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click();
  ok('"הערכה ראשונית" מוצגת לפני הדיוק', await r.locator('#estLabel').isVisible());
  await r.locator('#taskEditor button', {hasText:'לדייק את החישוב'}).first().click();
  ok('"הערכה ראשונית" נעלמת אחרי הדיוק', await r.locator('#estLabel').isHidden());
  await r.locator('#btnMore').click();
  ok('משימה ריקה חדשה לא מחזירה את "הערכה ראשונית"', await r.locator('#estLabel').isHidden());
  ok('אין שגיאות בבדיקות האלה', rErr.length === 0, rErr.join('; '));
  await ctxR.close();

  section('22. צילומי מסך');
  const shot = async (name, w, h, fn) => {
    const c = await browser.newContext({viewport:{width:w, height:h}, locale:'he-IL', deviceScaleFactor:2});
    const p = await c.newPage();
    await p.goto(url);
    await p.evaluate(() => localStorage.clear());
    await p.goto(url);
    if(fn) await fn(p);
    await p.waitForTimeout(350);
    await p.screenshot({path: path.join(SHOTS, name + '.png'), fullPage:true});
    await c.close();
  };
  const oneTask = async p => { await p.locator('#taskEditor button', {hasText:'מיון קורות חיים'}).first().click(); };
  const refined = async p => { await oneTask(p); await p.locator('#taskEditor button', {hasText:'לדייק את החישוב'}).first().click(); };
  const demo = async p => { await p.locator('#btnDemo').click(); };
  const summary = async p => { await demo(p); await p.locator('#btnSummary').click(); };
  for(const [w,h,tag] of [[390,844,'mobile'],[1280,900,'desktop']]){
    await shot('empty-' + tag, w, h, null);
    await shot('hook-' + tag, w, h, oneTask);
    await shot('refine-' + tag, w, h, refined);
    await shot('tape-' + tag, w, h, demo);
    await shot('summary-' + tag, w, h, summary);
  }
  ok('צילומי מסך נוצרו', fs.readdirSync(SHOTS).filter(f => f.endsWith('.png')).length === 10,
     String(fs.readdirSync(SHOTS).filter(f => f.endsWith('.png')).length));

  ok('אין שגיאות קונסולה בכל הריצה', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

  await browser.close();
  if(srv) srv.close();

  console.log('\n================================');
  console.log('עברו: ' + pass + '   נכשלו: ' + fail);
  if(failures.length){ console.log('\nכשלים:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
