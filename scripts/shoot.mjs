// Phone-width screenshots of the running server, with the page's real
// scrollWidth and any element that pokes past the viewport, so "it overflows"
// is a measurement and not an impression.
//   node scripts/shoot.mjs out-dir name=/path [name=/path ...]
// Requires a running server on :8790 and Google Chrome (via playwright's
// 'chrome' channel — no separate browser download).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
// playwright is not a dependency of this repo; point PLAYWRIGHT at an install
// elsewhere (e.g. .../agent sync/node_modules/playwright/index.mjs).
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || !specs.length) {
  console.error('usage: node scripts/shoot.mjs <out-dir> name=/path ...');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const W = 375;
const H = 812;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const spec of specs) {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq);
  const path = spec.slice(eq + 1); // the path may itself contain '=' (?fixture=x)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  await page.goto(`http://localhost:8790${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const report = await page.evaluate((w) => {
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 0.5 && r.width > 0) {
        const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
        wide.push(`${el.tagName.toLowerCase()}${cls} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, wide: wide.slice(0, 12) };
  }, W);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`${name}: scrollWidth=${report.scrollWidth}${errors.length ? ` errors=${JSON.stringify(errors)}` : ''}`);
  for (const line of report.wide) console.log(`   ${line}`);
  await page.close();
}
await browser.close();
