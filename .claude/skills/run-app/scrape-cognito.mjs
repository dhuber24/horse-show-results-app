// One-off: render a client-side Cognito Forms page and dump its visible text.
// The public form URL serves a 3KB shell; everything is drawn by seamless.js.
import { chromium } from 'playwright';

const urls = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 2000 } });

for (const url of urls) {
  console.log('\n' + '='.repeat(78));
  console.log('URL:', url);
  console.log('='.repeat(78));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    // The form mounts into .cog-form; wait for it rather than a fixed sleep.
    await page.waitForSelector('.cog-form, .cog-body, form', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => {
      const root = document.querySelector('.cog-form') || document.body;
      return root.innerText;
    });
    console.log(text.replace(/\n{3,}/g, '\n\n'));
  } catch (err) {
    console.log('FAILED:', err.message);
  }
}

await browser.close();
