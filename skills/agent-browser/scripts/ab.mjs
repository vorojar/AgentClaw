#!/usr/bin/env node
// ab.mjs — agent-browser wrapper with Chrome 146+ CDP auto-connect
// Usage: node skills/agent-browser/scripts/ab.mjs <agent-browser args...>
//
// Priority chain:
// 1. Detect Chrome CDP on 127.0.0.1:9222 → auto-connect (user's real browser, full login state)
// 2. On `open` commands, scan data/browser-states/*.json for matching domain cookies
// 3. Fall through to agent-browser headless mode

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";

const PROJECT_ROOT = process.cwd();
const STATES_DIR = join(PROJECT_ROOT, "data", "browser-states");
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9222;
const CDP_WS = `ws://${CDP_HOST}:${CDP_PORT}/devtools/browser`;

// ── Chrome CDP detection ──

/** Quick TCP probe: resolve true if port is open, false otherwise */
function probePort(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("timeout", () => { sock.destroy(); resolve(false); });
    sock.on("error", () => { sock.destroy(); resolve(false); });
  });
}

/** Check if agent-browser already has an active CDP session */
function isAlreadyConnected() {
  try {
    // `agent-browser status` exits 0 when connected
    execFileSync("agent-browser", ["status"], {
      stdio: "pipe",
      shell: true,
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Auto-connect to Chrome CDP if available */
async function ensureCdpConnect() {
  // Skip if already connected
  if (isAlreadyConnected()) return;

  // Probe CDP port
  const open = await probePort(CDP_HOST, CDP_PORT);
  if (!open) return;

  // Attempt connect
  try {
    execFileSync("agent-browser", ["connect", CDP_WS], {
      stdio: "pipe",
      shell: true,
      timeout: 10000,
    });
    process.stderr.write(`[ab] Auto-connected to Chrome CDP at ${CDP_WS}\n`);
  } catch {
    // Chrome may be listening but not allowing CDP (dialog not accepted, etc.)
    // Silently fall back to headless mode
  }
}

// ── Login state matching (fallback for headless mode) ──

function findStateForUrl(url) {
  if (!existsSync(STATES_DIR)) return null;

  let targetHost;
  try {
    targetHost = new URL(url).hostname;
  } catch {
    return null;
  }

  const files = readdirSync(STATES_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const data = JSON.parse(
        readFileSync(join(STATES_DIR, file), "utf8"),
      );
      const cookies = data.cookies || [];
      for (const c of cookies) {
        const domain = (c.domain || "").replace(/^\./, "");
        if (
          targetHost === domain ||
          targetHost.endsWith("." + domain)
        ) {
          return join(STATES_DIR, file);
        }
      }
    } catch {
      // skip malformed files
    }
  }
  return null;
}

// ── Main ──

const args = process.argv.slice(2);
const firstCmd = args[0];

// Block `close` BEFORE connecting — it would send Browser.close and kill Chrome
if (firstCmd === "close" && await probePort(CDP_HOST, CDP_PORT)) {
  process.stderr.write(
    `[ab] Blocked 'close' — would kill the user's Chrome. Use 'tab close' to close a tab instead.\n`,
  );
  process.exit(0);
}

// Auto-connect to Chrome CDP before running any command
await ensureCdpConnect();

// Build final args
let finalArgs = [...args];

// For open commands in headless mode (no CDP), try login state injection
const OPEN_CMDS = ["open", "goto", "navigate"];
const openIdx = args.findIndex((a) => OPEN_CMDS.includes(a));

if (openIdx !== -1 && args[openIdx + 1] && !args.includes("--state")) {
  const url = args[openIdx + 1];
  const stateFile = findStateForUrl(url);
  if (stateFile) {
    finalArgs = ["--state", stateFile, ...args];
    process.stderr.write(`[ab] Auto-loaded login: ${stateFile}\n`);
  }
}

const child = spawn("agent-browser", finalArgs, {
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => process.exit(code || 0));
