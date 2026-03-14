#!/usr/bin/env node
// ab.mjs — agent-browser wrapper with auto login state injection
// Usage: node skills/agent-browser/scripts/ab.mjs <agent-browser args...>
//
// On `open` commands, scans data/browser-states/*.json for matching domain cookies.
// If found, auto-injects --state <file>. Falls through to agent-browser for everything else.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// Project root = gateway CWD (shell inherits it)
const PROJECT_ROOT = process.cwd();
const STATES_DIR = join(PROJECT_ROOT, "data", "browser-states");

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

const args = process.argv.slice(2);

// Detect open/goto/navigate command
const OPEN_CMDS = ["open", "goto", "navigate"];
const openIdx = args.findIndex((a) => OPEN_CMDS.includes(a));

let finalArgs = [...args];

if (openIdx !== -1 && args[openIdx + 1] && !args.includes("--state")) {
  const url = args[openIdx + 1];
  const stateFile = findStateForUrl(url);
  if (stateFile) {
    // --state must come before the subcommand
    finalArgs = ["--state", stateFile, ...args];
    process.stderr.write(`[ab] Auto-loaded login: ${stateFile}\n`);
  }
}

const child = spawn("agent-browser", finalArgs, {
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => process.exit(code || 0));
