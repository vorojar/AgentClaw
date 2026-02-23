/**
 * AgentClaw Browser Bridge — background service worker.
 * Connects to Gateway via WebSocket, receives commands, executes them using chrome.* APIs.
 */

let ws = null;
let connected = false;

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

async function getConfig() {
  const data = await chrome.storage.local.get(["serverUrl", "apiKey"]);
  return {
    serverUrl: data.serverUrl || "ws://localhost:3100",
    apiKey: data.apiKey || "",
  };
}

async function connect() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const { serverUrl, apiKey } = await getConfig();
  if (!apiKey) {
    console.log("[AgentClaw] No API key configured, skipping connection");
    return;
  }

  const url = `${serverUrl}/ws/ext?api_key=${encodeURIComponent(apiKey)}`;
  console.log("[AgentClaw] Connecting to", serverUrl);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("[AgentClaw] WebSocket creation failed:", err);
    setConnected(false);
    return;
  }

  let heartbeatTimer = null;

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        stopHeartbeat();
        return;
      }
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // send failed → connection is dead
        stopHeartbeat();
        ws.close();
      }
    }, 15000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  ws.onopen = () => {
    console.log("[AgentClaw] Connected");
    setConnected(true);
    startHeartbeat();
  };

  ws.onclose = () => {
    console.log("[AgentClaw] Disconnected, reconnecting...");
    stopHeartbeat();
    setConnected(false);
    ws = null;
    // setTimeout for immediate reconnect (works if service worker is alive)
    setTimeout(connect, 2000);
    // Alarm as backup (survives service worker suspension, min 30s delay)
    chrome.alarms.create("reconnect", { delayInMinutes: 0.5 });
  };

  ws.onerror = (err) => {
    console.error("[AgentClaw] WebSocket error:", err);
    setConnected(false);
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const { id, action, args } = msg;
    if (!id || !action) return;

    try {
      const result = await handleCommand(action, args || {});
      ws.send(JSON.stringify({ id, result }));
    } catch (err) {
      ws.send(JSON.stringify({ id, error: err.message || String(err) }));
    }
  };
}

function setConnected(value) {
  connected = value;
  // Update badge to indicate connection status
  chrome.action.setBadgeText({ text: value ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({
    color: value ? "#22c55e" : "#ef4444",
  });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleCommand(action, args) {
  switch (action) {
    case "open":
      return await cmdOpen(args);
    case "screenshot":
      return await cmdScreenshot();
    case "click":
      return await cmdClick(args);
    case "type":
      return await cmdType(args);
    case "get_content":
      return await cmdGetContent(args);
    case "close":
      return await cmdClose();
    case "wait_for":
      return await cmdWaitFor(args);
    case "sleep":
      await new Promise((r) => setTimeout(r, args.ms || 1000));
      return { slept: args.ms || 1000 };
    case "batch":
      return await cmdBatch(args);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  return tab;
}

async function cmdOpen({ url }) {
  if (!url) throw new Error("URL required");

  const tab = await chrome.tabs.create({ url, active: true });

  // Wait for the tab to finish loading
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve anyway after timeout
    }, 30000);

    function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // If already complete
    if (tab.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      resolve();
    }
  });

  // Only return title + URL; use get_content to read page text
  const updatedTab = await chrome.tabs.get(tab.id);
  return {
    title: updatedTab.title || "",
    url: updatedTab.url || url,
  };
}

async function cmdScreenshot() {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
  // Return base64 data (strip "data:image/png;base64," prefix)
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return { base64 };
}

async function cmdClick({ selector }) {
  if (!selector) throw new Error("Selector required");
  const tab = await getActiveTab();

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.click();
      return true;
    },
    args: [selector],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { clicked: selector };
}

async function cmdType({ selector, text }) {
  if (!selector || text === undefined)
    throw new Error("Selector and text required");
  const tab = await getActiveTab();

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.focus();

      const isContentEditable =
        el.isContentEditable ||
        (el.getAttribute && el.getAttribute("contenteditable") === "true");
      const isInput = el.tagName === "INPUT" || el.tagName === "TEXTAREA";

      const enterOpts = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      };
      const dispatchEnter = () => {
        el.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
        el.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
        if (isInput && el.form) {
          try {
            el.form.requestSubmit();
          } catch {
            el.form.submit();
          }
        }
      };

      // Pure newline → just press Enter
      if (txt === "\n" || txt === "\r\n") {
        dispatchEnter();
        return true;
      }

      const endsWithNewline = txt.endsWith("\n") || txt.endsWith("\r\n");
      const content = endsWithNewline ? txt.replace(/\r?\n$/, "") : txt;

      if (isContentEditable) {
        // contentEditable: execCommand fires beforeinput/input events
        // that Draft.js / Slate / ProseMirror listen to
        document.execCommand("insertText", false, content);
      } else {
        el.value = content;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (endsWithNewline) dispatchEnter();
      return true;
    },
    args: [selector, text],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { typed: selector };
}

async function cmdGetContent({ selector }) {
  const tab = await getActiveTab();
  const MAX_CONTENT = 50000;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        return el.innerText ?? el.textContent ?? "";
      }
      return document.body.innerText;
    },
    args: [selector || null],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  let text = results[0]?.result || "";
  if (text.length > MAX_CONTENT) {
    text = text.slice(0, MAX_CONTENT) + "\n\n... [truncated]";
  }
  return { text };
}

async function cmdClose() {
  const tab = await getActiveTab();
  await chrome.tabs.remove(tab.id);
  return { closed: true };
}

// ---------------------------------------------------------------------------
// Wait for element & batch execution
// ---------------------------------------------------------------------------

async function waitForSelector(selector, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        // For buttons: also wait until enabled (e.g. X disables send while loading URL preview)
        if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
          return !el.disabled && el.getAttribute("aria-disabled") !== "true";
        }
        return true;
      },
      args: [selector],
    });
    if (results[0]?.result) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for: ${selector}`);
}

async function cmdWaitFor({ selector, timeout }) {
  if (!selector) throw new Error("Selector required");
  await waitForSelector(selector, timeout || 5000);
  return { found: selector };
}

async function cmdBatch({ steps }) {
  if (!Array.isArray(steps) || steps.length === 0)
    throw new Error("steps must be a non-empty array");
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      // Auto-wait for selector before click/type (SPA-friendly)
      if (
        step.args?.selector &&
        (step.action === "click" || step.action === "type")
      ) {
        await waitForSelector(step.args.selector, step.args.timeout || 5000);
      }
      const result = await handleCommand(step.action, step.args || {});
      results.push({ step: i + 1, action: step.action, ok: true, ...result });
    } catch (err) {
      results.push({
        step: i + 1,
        action: step.action,
        ok: false,
        error: err.message,
      });
      break;
    }
  }
  return { results };
}

// ---------------------------------------------------------------------------
// Keep-alive & auto-reconnect via chrome.alarms
// ---------------------------------------------------------------------------

chrome.alarms.create("keepalive", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive" || alarm.name === "reconnect") {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    }
  }
});

// Reconnect when config changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.serverUrl || changes.apiKey)) {
    if (ws) {
      ws.close();
      ws = null;
    }
    connect();
  }
});

// Clear stale badge on service worker restart, then connect
setConnected(false);
connect();
