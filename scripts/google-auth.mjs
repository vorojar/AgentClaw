/**
 * One-time script to obtain Google OAuth2 refresh_token.
 *
 * Usage: node scripts/google-auth.mjs
 *
 * 1. Opens browser for authorization
 * 2. User grants access
 * 3. Paste the authorization code back
 * 4. Script prints the refresh_token
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { platform } from "node:os";
import * as readline from "node:readline";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = "http://localhost:9876/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

// Open URL in default browser
function openBrowser(url) {
  const os = platform();
  const cmd =
    os === "win32"
      ? `start "" "${url}"`
      : os === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

// Exchange authorization code for tokens
async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return res.json();
}

// Start a local server to capture the callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:9876`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Authorization failed: ${error}</h1>`);
      console.error(`\nAuthorization failed: ${error}`);
      process.exit(1);
    }

    if (code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<h1>Authorization successful!</h1><p>You can close this tab.</p>`,
      );

      try {
        const tokens = await exchangeCode(code);
        console.log("\n========================================");
        console.log("Add these to your .env file:");
        console.log("========================================\n");
        console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
        console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log("\n========================================");
      } catch (err) {
        console.error("\nError:", err.message);
      }

      server.close();
      process.exit(0);
    }
  }

  res.writeHead(404);
  res.end();
});

server.listen(9876, () => {
  console.log("Opening browser for Google authorization...\n");
  console.log("If the browser doesn't open, visit this URL manually:");
  console.log(authUrl + "\n");
  openBrowser(authUrl);
});
