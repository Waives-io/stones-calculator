/* Two screenshots of the summary heading, one per gold, so Galli can choose.
   node gold-ab.js   →   qa/shots/gold-dark.png, qa/shots/gold-light.png  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8778;

(async () => {
  const srv = http.createServer((req, rep) => {
    rep.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    rep.end(fs.readFileSync(path.join(ROOT, 'index.html')));
  }).listen(PORT);
  fs.mkdirSync(SHOTS, {recursive:true});

  const browser = await chromium.launch();
  for(const [name, heading] of [['gold-dark','#A07830'], ['gold-light','#C9A84C']]){
    const ctx = await browser.newContext({viewport:{width:1280, height:620}, locale:'he-IL', deviceScaleFactor:2});
    const p = await ctx.newPage();
    await p.goto('http://localhost:' + PORT + '/');
    await p.evaluate(() => localStorage.clear());
    await p.goto('http://localhost:' + PORT + '/');
    await p.locator('#btnDemo').click();
    await p.locator('#btnSummary').click();
    // only the heading colour changes; every other token stays exactly as designed
    await p.addStyleTag({content: '#summary h1, #summary h2 { color: ' + heading + ' !important; }'});
    await p.waitForTimeout(300);
    await p.locator('#summary').screenshot({path: path.join(SHOTS, name + '.png')});
    const ratio = await p.evaluate(() => {
      const lum = hex => {
        const c = [1,3,5].map(i => parseInt(hex.substr(i,2),16)/255)
          .map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
        return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
      };
      const h = getComputedStyle(document.querySelector('#summary h1')).color;
      const m = h.match(/\d+/g).map(Number);
      const hex = '#' + m.slice(0,3).map(x => x.toString(16).padStart(2,'0')).join('');
      const L = lum(hex);
      return {hex, ratio: Math.round(((1.05) / (L + 0.05)) * 100) / 100};
    });
    console.log(name, '→', ratio.hex, 'contrast on white:', ratio.ratio + ':1',
                ratio.ratio >= 4.5 ? '(AA ✓)' : ratio.ratio >= 3 ? '(AA for 24px+ bold only)' : '(fails AA)');
    await ctx.close();
  }
  await browser.close();
  srv.close();
  console.log('\nqa/shots/gold-dark.png  ·  qa/shots/gold-light.png');
})().catch(e => { console.error(e); process.exit(1); });
