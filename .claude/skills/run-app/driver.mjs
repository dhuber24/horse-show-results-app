#!/usr/bin/env node
// Minimal chromium-cli-style REPL driver for the Horse Show Results frontend,
// built on Playwright (no chromium-cli binary is available on this machine).
// Reads newline-delimited commands from stdin, one per line:
//
//   nav <url>
//   wait-for text=<substring> | wait-for <css selector>
//   wait-url <substring>      (waits for page.url() to contain this)
//   click <css selector>
//   fill <css selector> <value...>
//   press <key>
//   screenshot [name]
//   console-errors
//   eval <js expression>
//   sleep <ms>
//   quit
//
// NOTE: this app's Next.js dev server compiles routes on demand. The first
// nav to a given route (and the client-side redirect right after login/
// register) can take 15-25s. wait-for/wait-url/click default to a generous
// timeout to absorb that -- don't lower them just because a "normal" web app
// would answer faster.
//
// Screenshots land in .claude/skills/run-app/screenshots/,
// latest also copied to screenshot.png.

import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const consoleErrors = [];
let shotCount = 0;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

function parseTarget(sel) {
  if (sel.startsWith('text=')) return page.getByText(sel.slice(5), { exact: false });
  return page.locator(sel);
}

async function handle(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const sp = trimmed.indexOf(' ');
  const cmd = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const rest = sp === -1 ? '' : trimmed.slice(sp + 1);

  try {
    switch (cmd) {
      case 'nav':
        await page.goto(rest, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`OK nav ${rest} -> ${page.url()}`);
        break;
      case 'wait-for':
        await parseTarget(rest).first().waitFor({ state: 'visible', timeout: 30000 });
        console.log(`OK wait-for ${rest}`);
        break;
      case 'wait-url':
        await page.waitForURL((url) => url.toString().includes(rest), { timeout: 30000 });
        console.log(`OK wait-url ${rest} -> ${page.url()}`);
        break;
      case 'click':
        await parseTarget(rest).first().click({ timeout: 15000 });
        console.log(`OK click ${rest}`);
        break;
      case 'fill': {
        const sp2 = rest.indexOf(' ');
        const sel = rest.slice(0, sp2);
        const value = rest.slice(sp2 + 1);
        await parseTarget(sel).first().fill(value, { timeout: 15000 });
        console.log(`OK fill ${sel}`);
        break;
      }
      case 'set-file': {
        // `set-file <selector> <path>` — drives an <input type="file">, including
        // the visually-hidden ones behind a styled drop-zone label.
        const sp3 = rest.indexOf(' ');
        const sel = rest.slice(0, sp3);
        const filePath = rest.slice(sp3 + 1);
        await parseTarget(sel).first().setInputFiles(filePath, { timeout: 15000 });
        console.log(`OK set-file ${sel} <- ${filePath}`);
        break;
      }
      case 'press':
        await page.keyboard.press(rest);
        console.log(`OK press ${rest}`);
        break;
      case 'screenshot': {
        shotCount += 1;
        const name = rest || `shot-${String(shotCount).padStart(2, '0')}`;
        const dest = path.join(shotDir, `${name}.png`);
        await page.screenshot({ path: dest, fullPage: true });
        copyFileSync(dest, path.join(shotDir, 'screenshot.png'));
        console.log(`OK screenshot ${dest}`);
        break;
      }
      case 'console-errors':
        console.log(consoleErrors.length ? `ERRORS:\n${consoleErrors.join('\n')}` : 'OK no console errors');
        break;
      case 'eval': {
        const result = await page.evaluate(rest);
        console.log(`OK eval -> ${JSON.stringify(result)}`);
        break;
      }
      case 'sleep':
        await new Promise((r) => setTimeout(r, Number(rest)));
        console.log(`OK sleep ${rest}`);
        break;
      case 'quit':
        await browser.close();
        process.exit(0);
        break;
      default:
        console.log(`ERR unknown command: ${cmd}`);
    }
  } catch (err) {
    console.log(`ERR ${cmd}: ${err.message.split('\n')[0]}`);
  }
}

const rl = createInterface({ input: process.stdin });
let queue = Promise.resolve();
let closed = false;
rl.on('line', (line) => {
  queue = queue.then(() => handle(line));
});
rl.on('close', async () => {
  await queue;
  if (!closed) {
    closed = true;
    await browser.close();
    process.exit(0);
  }
});
