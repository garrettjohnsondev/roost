// Render the app the way a phone does, before a deploy is allowed to land.
//
// 2026-09-24: a change passed every test and still made every session crash on
// open, all day — nothing ever RENDERED the app before it shipped. This loads
// home, every design fixture (including an empty session, the case that broke)
// and every live session at a true 390px phone viewport, and fails if any page
// throws, shows the crash screen, or is wider than the phone.
//
// It runs against the server that is up, which serves the freshly built web
// bundle straight from disk — so it tests the new front end before the restart.
// No server running, or no Chrome on this machine: it says so and does not block.
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.ROOST_SMOKE_URL ?? 'http://localhost:8790';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch { skip('puppeteer-core is not installed'); }
if (!existsSync(CHROME)) skip('Google Chrome is not installed');
try { await fetch(BASE + '/api/config', { signal: AbortSignal.timeout(3000) }); } catch { skip(`no Roost server at ${BASE}`); }

function skip(why) { console.log(`smoke: skipped — ${why}`); process.exit(0); }

const fixtures = [...readFileSync(new URL('../web/src/fixtures.ts', import.meta.url), 'utf8').matchAll(/^\s{2}'?([a-z-]+)'?: \(\) =>/gm)].map((m) => m[1]);
let sessions = [];
try { const d = await (await fetch(BASE + '/api/sessions')).json(); sessions = (d.sessions ?? d).map((s) => s.id); } catch { /* none */ }
const pages = [['home', '/'], ...fixtures.map((f) => [`fixture:${f}`, `/?fixture=${f}`]), ...sessions.map((id) => [`session:${id.slice(0, 8)}`, `/?s=${id}`])];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const failures = [];
for (const [name, path] of pages) {
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  // Never let a smoke run start anything real.
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.method() !== 'GET' && !r.url().includes('/api/config') ? r.abort() : r.continue()));
  const problems = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && /Roost crashed/.test(m.text())) problems.push('crash screen'); });
  await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => problems.push(`load: ${e.message}`));
  await new Promise((r) => setTimeout(r, 1200));
  const r = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, crashed: /Something broke|couldn.t continue/i.test(document.body.innerText) })).catch(() => ({ width: 0, crashed: true }));
  if (r.crashed) problems.push('crash screen shown');
  if (r.width > 390) problems.push(`page is ${r.width}px wide on a 390px phone`);
  console.log(`  ${problems.length ? '✗' : '✓'} ${name}${problems.length ? ' — ' + [...new Set(problems)].join('; ') : ''}`);
  if (problems.length) failures.push(name);
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error(`smoke: ${failures.length} of ${pages.length} pages failed — NOT deploying`);
  process.exit(1);
}
console.log(`smoke: ${pages.length} pages rendered clean at 390px`);
