#!/usr/bin/env node
/**
 * Browser control via AgentClaw Gateway + Chrome Extension.
 * Usage: node browser.mjs <action> [args...]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.PORT || 3100;
const API_KEY = process.env.API_KEY || '';
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = resolve(process.cwd(), 'data', 'tmp');

async function exec(action, args = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${BASE_URL}/api/browser/exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, args }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data.result;
}

async function main() {
  const [,, action, ...rest] = process.argv;
  if (!action) {
    console.error('Usage: node browser.mjs <open|screenshot|click|type|scroll|get_content|close|batch|wait_for|sleep> [args...]');
    process.exit(1);
  }

  switch (action) {
    case 'open': {
      const url = rest[0];
      if (!url) { console.error('Error: URL required'); process.exit(1); }
      const result = await exec('open', { url });
      console.log(`Page: ${result.title}\nURL: ${result.url}`);
      break;
    }
    case 'screenshot': {
      const result = await exec('screenshot');
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const filePath = resolve(SCREENSHOT_DIR, `browser_screenshot_${Date.now()}.png`);
      writeFileSync(filePath, Buffer.from(result.base64, 'base64'));
      console.log(`Screenshot saved: ${filePath.replace(/\\/g, '/')}`);
      break;
    }
    case 'click': {
      const selector = rest[0];
      if (!selector) { console.error('Error: selector required'); process.exit(1); }
      await exec('click', { selector });
      console.log(`Clicked: ${selector}`);
      break;
    }
    case 'type': {
      const [selector, rawText] = rest;
      if (!selector || !rawText) { console.error('Error: selector and text required'); process.exit(1); }
      // Convert literal \n from CLI args to real newline (LLM sends "\\n" via shell)
      const text = rawText.replace(/\\n/g, '\n');
      await exec('type', { selector, text });
      console.log(`Typed into: ${selector}`);
      break;
    }
    case 'get_content': {
      const selector = rest[0];
      const result = await exec('get_content', { selector });
      console.log(result.text);
      break;
    }
    case 'close': {
      await exec('close');
      console.log('Tab closed.');
      break;
    }
    case 'batch': {
      const json = rest[0];
      if (!json) { console.error('Error: JSON array of steps required'); process.exit(1); }
      let steps;
      try { steps = JSON.parse(json); } catch { console.error('Error: invalid JSON'); process.exit(1); }
      const autoClose = rest.includes('--auto-close');
      const result = await exec('batch', { steps, auto_close: autoClose });
      for (const r of result.results) {
        const tag = r.ok ? 'OK' : 'FAIL';
        let detail = '';
        if (r.action === 'screenshot' && r.base64) {
          mkdirSync(SCREENSHOT_DIR, { recursive: true });
          const fp = resolve(SCREENSHOT_DIR, `browser_screenshot_${Date.now()}.png`);
          writeFileSync(fp, Buffer.from(r.base64, 'base64'));
          detail = `saved ${fp.replace(/\\/g, '/')}`;
        } else if (r.action === 'open') {
          detail = `${r.title} | ${r.url}`;
        } else if (r.action === 'get_content') {
          detail = (r.text || '').slice(0, 5000);
        } else if (r.action === 'scroll') {
          detail = `${r.scrolled} | scrollTop: ${r.scrollTop}, scrollHeight: ${r.scrollHeight}`;
        } else if (r.error) {
          detail = r.error;
        }
        console.log(`[${r.step}/${steps.length}] ${r.action} → ${tag}${detail ? ' | ' + detail : ''}`);
      }
      break;
    }
    case 'wait_for': {
      const selector = rest[0];
      const timeout = rest[1] ? parseInt(rest[1]) : undefined;
      if (!selector) { console.error('Error: selector required'); process.exit(1); }
      await exec('wait_for', { selector, timeout });
      console.log(`Found: ${selector}`);
      break;
    }
    case 'sleep': {
      const ms = parseInt(rest[0]) || 1000;
      await exec('sleep', { ms });
      console.log(`Slept ${ms}ms`);
      break;
    }
    case 'scroll': {
      const direction = rest[0] || 'down';
      const pixels = rest[1] ? parseInt(rest[1]) : undefined;
      const result = await exec('scroll', { direction, pixels });
      console.log(`Scrolled ${direction} | scrollTop: ${result.scrollTop}, scrollHeight: ${result.scrollHeight}, viewport: ${result.viewportHeight}`);
      break;
    }
    case 'reload': {
      await exec('reload');
      console.log('Extension reloading...');
      break;
    }
    case 'save_login': {
      const name = rest[0];
      if (!name) { console.error('Error: name required (e.g. save_login xiaohongshu)'); process.exit(1); }
      const result = await exec('save_login', { name });
      console.log(`Login state saved: ${result.saved}\nDomain: ${result.domain}\nCookies: ${result.cookieCount}`);
      break;
    }
    case 'list_logins': {
      const headers = { 'Content-Type': 'application/json' };
      if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
      const res = await fetch(`${BASE_URL}/api/browser/states`, { headers });
      const states = await res.json();
      if (states.length === 0) {
        console.log('No saved login states.\nUse: save_login <name> (on a logged-in page) to save.');
      } else {
        console.log(`Saved login states (${states.length}):`);
        for (const s of states) console.log(`  - ${s}`);
      }
      break;
    }
    case 'search': {
      const query = rest.join(' ');
      if (!query) { console.error('Error: search query required'); process.exit(1); }
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const result = await exec('open', { url: searchUrl });
      console.log(`Searched: ${query}\nPage: ${result.title}\nURL: ${result.url}`);
      break;
    }
    default:
      console.error(`Unknown action: ${action}. Use: open, search, screenshot, click, type, scroll, get_content, save_login, list_logins, close`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
