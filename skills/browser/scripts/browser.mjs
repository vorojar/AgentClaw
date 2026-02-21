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
    console.error('Usage: node browser.mjs <open|screenshot|click|type|get_content|close> [args...]');
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
    case 'search': {
      const query = rest.join(' ');
      if (!query) { console.error('Error: search query required'); process.exit(1); }
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const result = await exec('open', { url: searchUrl });
      console.log(`Searched: ${query}\nPage: ${result.title}\nURL: ${result.url}`);
      break;
    }
    default:
      console.error(`Unknown action: ${action}. Use: open, search, screenshot, click, type, get_content, close`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
