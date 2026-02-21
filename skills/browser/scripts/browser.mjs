#!/usr/bin/env node
/**
 * Browser control via Chrome DevTools Protocol.
 * Usage: node browser.mjs <action> [args...]
 */

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync, spawn } from 'node:child_process';

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const SCREENSHOT_DIR = resolve(process.cwd(), 'data', 'tmp');
const PROFILE_DIR = resolve(process.cwd(), 'data', 'chrome-profile');
const NAV_TIMEOUT = 30000;
const MAX_CONTENT = 50000;
const MAX_OPEN_CONTENT = 8000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function detectBrowserPath() {
  const platform = process.platform;
  const candidates = platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function isChromeRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      if (out.includes('chrome.exe')) return true;
      const out2 = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return out2.includes('msedge.exe');
    }
    const out = execSync("pgrep -f '(chrome|chromium|msedge)' || true", { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  // Try connecting to existing CDP
  try {
    return await puppeteer.connect({ browserURL: CDP_URL });
  } catch {}

  const exe = detectBrowserPath();
  if (!exe) {
    console.error('Error: Chrome or Edge not found.');
    process.exit(1);
  }

  const running = isChromeRunning();
  if (running) {
    mkdirSync(PROFILE_DIR, { recursive: true });
    const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  for (let i = 0; i < 15; i++) {
    await sleep(500);
    try {
      return await puppeteer.connect({ browserURL: CDP_URL });
    } catch {}
  }

  console.error('Error: Cannot connect to Chrome CDP.');
  process.exit(1);
}

async function main() {
  const [,, action, ...rest] = process.argv;
  if (!action) {
    console.error('Usage: node browser.mjs <open|screenshot|click|type|get_content|close> [args...]');
    process.exit(1);
  }

  const browser = await ensureBrowser();
  const pages = await browser.pages();
  let page = pages.find(p => !p.url().startsWith('chrome://')) || await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  try {
    switch (action) {
      case 'open': {
        const url = rest[0];
        if (!url) { console.error('Error: URL required'); process.exit(1); }
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        let text = '';
        try {
          text = await page.evaluate(() => {
            document.querySelectorAll('script,style,noscript,svg,iframe,nav,footer,header,[role=navigation],[role=banner],[aria-hidden=true]').forEach(el => el.remove());
            return document.body?.innerText ?? '';
          });
          text = text.replace(/\n{3,}/g, '\n\n').trim();
          if (text.length > MAX_OPEN_CONTENT) text = text.slice(0, MAX_OPEN_CONTENT) + '\n\n... [truncated]';
        } catch {}
        console.log(`Page: ${title}\nURL: ${page.url()}\n\n${text}`);
        break;
      }
      case 'screenshot': {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const filePath = resolve(SCREENSHOT_DIR, `browser_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
        console.log(`Screenshot saved: ${filePath}`);
        break;
      }
      case 'click': {
        const selector = rest[0];
        if (!selector) { console.error('Error: selector required'); process.exit(1); }
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        console.log(`Clicked: ${selector}`);
        break;
      }
      case 'type': {
        const [selector, text] = rest;
        if (!selector || !text) { console.error('Error: selector and text required'); process.exit(1); }
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.type(selector, text);
        console.log(`Typed into: ${selector}`);
        break;
      }
      case 'get_content': {
        const selector = rest[0];
        let text;
        if (selector) {
          await page.waitForSelector(selector, { timeout: 5000 });
          text = await page.$eval(selector, el => el.innerText ?? el.textContent ?? '');
        } else {
          text = await page.evaluate(() => document.body.innerText);
        }
        if (text.length > MAX_CONTENT) text = text.slice(0, MAX_CONTENT) + '\n\n... [truncated]';
        console.log(text);
        break;
      }
      case 'close': {
        await page.close().catch(() => {});
        browser.disconnect();
        console.log('Tab closed.');
        break;
      }
      default:
        console.error(`Unknown action: ${action}. Use: open, screenshot, click, type, get_content, close`);
        process.exit(1);
    }
  } finally {
    if (action !== 'close') {
      browser.disconnect();
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
