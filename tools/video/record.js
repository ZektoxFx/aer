// Records one long take of the live AER site for the demo video (docs/VIDEO_PROMPT.md), logging when each moment
// happens. Needs Google Chrome and `npm install --no-save playwright-core@1.65.1`. Run: node tools/video/record.js [url]
// Writes video-out/rec/*.webm, video-out/shots/*.png and video-out/timeline.json (git-ignored).
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'https://aer-black.vercel.app/';
const OUT = path.join(__dirname, '..', '..', 'video-out');
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error('Google Chrome not found: set CHROME to its path.');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--window-size=1300,820'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: path.join(OUT, 'rec'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const log = [];
  const mark = async (name) => {
    const t = +((Date.now() - t0) / 1000).toFixed(2);
    log.push({ name, t });
    console.log(t, name);
    await page.screenshot({ path: path.join(OUT, 'shots', `${String(log.length).padStart(2, '0')}-${name}.png`) }).catch(() => {});
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const clickText = async (re) => {
    const b = page.locator('button', { hasText: re }).first();
    if (!(await b.count())) return false;
    await b.click().catch(() => {});
    return true;
  };
  const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };

  await page.goto(URL, { waitUntil: 'networkidle' });
  await wait(1500);
  await mark('title');
  await wait(3000);
  await clickText(/^START$/);
  await mark('start');

  // Let the whole intro play (a click would skip it) until the 3D game and its mission card are up.
  for (let i = 0; i < 240; i++) {
    await wait(1000);
    if (i % 5 === 4) await mark(`intro-${i + 1}s`);
    if ((await page.locator('.world3d canvas').count()) && (await page.locator('.v-quest, .v-mission').count())) break;
  }
  await mark('game');
  await wait(2500);
  await clickText(/LET'S GO|GOT IT/);
  await wait(800);
  await mark('howto-closed');

  // Walk, turning a little with the cursor at the right edge (hover look).
  await page.mouse.move(640, 360);
  await mark('walk-start');
  await page.keyboard.down('w');
  await wait(1500);
  await page.mouse.move(1250, 380);
  await wait(1200);
  await page.mouse.move(640, 360);
  await wait(1300);
  await page.keyboard.up('w');
  await mark('walk-end');
  await wait(800);

  // Plan a route on the minimap.
  const map = page.locator('.hud-map-canvas canvas').first();
  const b = (await map.count()) ? await map.boundingBox() : null;
  if (b) {
    await page.mouse.click(b.x + b.width * 0.30, b.y + b.height * 0.35);
    await wait(700);
    await page.mouse.click(b.x + b.width * 0.20, b.y + b.height * 0.25);
  }
  await wait(1500);
  await mark('route');
  await page.mouse.move(640, 360);

  // The pack and the REPAIRS tab.
  await page.keyboard.press('i');
  await wait(1500);
  await mark('pack');
  await clickText(/^REPAIRS/);
  await wait(2500);
  await mark('repairs');
  await page.keyboard.press('i');
  await wait(800);

  // Walk away from the lander (shelter cards don't show in the cabin), trigger a storm, pick a shelter.
  await hold('w', 2500);
  await mark('walked-out');
  await clickText(/MENU/);
  await wait(700);
  await clickText(/TRIGGER DUST STORM/);
  await mark('storm');
  await wait(4000);
  await mark('storm-cards');
  const picked = (await clickText(/WRECK/)) || (await clickText(/SHELTER|ROCK|COVER/));
  await wait(3500);
  await mark(picked ? 'shelter-picked' : 'no-shelter-button');
  await wait(1500);

  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(log, null, 1));
  const video = page.video();
  await context.close();
  console.log('video:', video ? await video.path() : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
