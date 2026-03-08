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

/** Convert ref-style selector (e.g. "e5") to CSS attribute selector */
function resolveSelector(sel) {
  return /^e\d+$/.test(sel) ? `[data-ac-ref="${sel}"]` : sel;
}

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
    case "scroll":
      return await cmdScroll(args);
    case "sleep":
      await new Promise((r) => setTimeout(r, args.ms || 1000));
      return { slept: args.ms || 1000 };
    case "batch":
      return await cmdBatch(args);
    case "paste_image":
      return await cmdPasteImage(args);
    case "save_login":
      return await cmdSaveLogin(args);
    case "reload":
      // Delay reload so the WS response can be sent first
      setTimeout(() => chrome.runtime.reload(), 200);
      return { reloading: true };
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

  // Support "text=xxx" selector — find element by exact visible text
  const textMatch = /^text=(.+)$/.exec(selector);
  if (textMatch) {
    const targetText = textMatch[1];
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (txt) => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
        );
        let node;
        while ((node = walker.nextNode())) {
          if (node.children.length === 0 && node.textContent.trim() === txt) {
            node.click();
            return true;
          }
        }
        // Fallback: partial match on innerText
        const all = document.querySelectorAll("*");
        for (const el of all) {
          if (el.innerText?.trim() === txt && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        throw new Error(`No element with text: ${txt}`);
      },
      args: [targetText],
    });
    if (results[0]?.error) throw new Error(results[0].error.message);
    return { clicked: selector };
  }

  const resolved = resolveSelector(selector);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.click();
      return true;
    },
    args: [resolved],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { clicked: selector };
}

async function cmdType({ selector, text }) {
  if (!selector || text === undefined)
    throw new Error("Selector and text required");
  const resolved = resolveSelector(selector);
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
    args: [resolved, text],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { typed: selector };
}

async function cmdGetContent({ selector }) {
  const tab = await getActiveTab();
  const MAX_CONTENT = 50000;
  const sel = selector ? resolveSelector(selector) : null;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, maxLen) => {
      // Clear old ref markers
      document
        .querySelectorAll("[data-ac-ref]")
        .forEach((el) => el.removeAttribute("data-ac-ref"));

      const root = sel ? document.querySelector(sel) : document.body;
      if (sel && !root) throw new Error(`Element not found: ${sel}`);

      let refCount = 0;
      const out = [];
      let len = 0;

      const SKIP = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "SVG",
        "LINK",
        "META",
        "TEMPLATE",
      ]);
      const INTERACT = new Set([
        "A",
        "BUTTON",
        "INPUT",
        "TEXTAREA",
        "SELECT",
        "SUMMARY",
      ]);
      const ROLES = new Set([
        "button",
        "link",
        "tab",
        "menuitem",
        "option",
        "checkbox",
        "radio",
        "switch",
        "textbox",
        "combobox",
        "searchbox",
      ]);
      const BLOCK = new Set([
        "DIV",
        "P",
        "SECTION",
        "ARTICLE",
        "MAIN",
        "HEADER",
        "FOOTER",
        "NAV",
        "ASIDE",
        "LI",
        "UL",
        "OL",
        "TABLE",
        "TR",
        "TD",
        "TH",
        "BLOCKQUOTE",
        "FIGURE",
        "FIGCAPTION",
        "PRE",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "DT",
        "DD",
        "FORM",
        "FIELDSET",
        "DETAILS",
      ]);

      function vis(el) {
        if (el.hidden || el.getAttribute("aria-hidden") === "true")
          return false;
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden";
      }

      function isInteractive(el) {
        if (el.tagName === "INPUT" && el.type === "hidden") return false;
        if (INTERACT.has(el.tagName)) return true;
        const r = el.getAttribute("role");
        if (r && ROLES.has(r)) return true;
        return false;
      }

      function getLabel(el) {
        const a = el.getAttribute("aria-label");
        if (a) return a.trim();
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
          return el.value || el.getAttribute("placeholder") || "";
        if (el.tagName === "SELECT")
          return el.options[el.selectedIndex]?.text || "";
        const t = (el.innerText || "").trim();
        return t.length > 80 ? t.slice(0, 77) + "\u2026" : t;
      }

      function desc(el) {
        const tag = el.tagName;
        const role = el.getAttribute("role");
        if (tag === "A") {
          const href = el.getAttribute("href") || "";
          const shortHref =
            href.length > 60 ? href.slice(0, 57) + "\u2026" : href;
          return `link "${getLabel(el)}"${href && !href.startsWith("javascript:") ? " \u2192 " + shortHref : ""}`;
        }
        if (tag === "BUTTON" || role === "button")
          return `button "${getLabel(el)}"`;
        if (tag === "INPUT") {
          const type = el.getAttribute("type") || "text";
          if (type === "checkbox" || type === "radio")
            return `${type} ${el.checked ? "\u2611" : "\u2610"} "${getLabel(el)}"`;
          return `input[${type}] "${getLabel(el)}"`;
        }
        if (tag === "TEXTAREA") return `textarea "${getLabel(el)}"`;
        if (tag === "SELECT") return `select "${getLabel(el)}"`;
        return `${(role || tag).toLowerCase()} "${getLabel(el)}"`;
      }

      function put(s) {
        if (len >= maxLen) return false;
        out.push(s);
        len += s.length;
        return true;
      }

      function walk(node) {
        if (len >= maxLen) return;
        if (node.nodeType === 3) {
          const t = node.textContent;
          if (t && t.trim()) put(t);
          return;
        }
        if (node.nodeType !== 1) return;

        const tag = node.tagName;
        if (SKIP.has(tag)) return;
        if (!vis(node)) return;

        // Heading → markdown style
        if (/^H[1-6]$/.test(tag)) {
          const t = (node.innerText || "").trim();
          if (t) put("\n" + "#".repeat(+tag[1]) + " " + t + "\n");
          return;
        }

        // Image
        if (tag === "IMG") {
          const alt = (node.getAttribute("alt") || "").trim();
          if (alt) put(`[img: ${alt}]`);
          return;
        }

        // Interactive element → assign ref
        if (isInteractive(node)) {
          refCount++;
          const ref = "e" + refCount;
          node.setAttribute("data-ac-ref", ref);
          put(`[${ref}] ${desc(node)}`);
          return;
        }

        // Block element → line break
        const isBlock = BLOCK.has(tag);
        if (isBlock) put("\n");
        for (const child of node.childNodes) walk(child);
        if (isBlock) put("\n");
      }

      walk(root);

      let result = out.join("");
      result = result.replace(/[ \t]+/g, " ");
      result = result.replace(/\n[ \t]*\n/g, "\n\n");
      result = result.replace(/\n{3,}/g, "\n\n");
      result = result.trim();

      if (result.length > maxLen) {
        result = result.slice(0, maxLen) + "\n\u2026 [truncated]";
      }
      return result;
    },
    args: [sel, MAX_CONTENT],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { text: results[0]?.result || "" };
}

async function cmdScroll({ direction, pixels, selector }) {
  const tab = await getActiveTab();
  const dir = direction || "down";

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (dir, px, sel) => {
      const el = sel ? document.querySelector(sel) : window;
      if (sel && !el) throw new Error(`Element not found: ${sel}`);
      const target = sel ? el : document.documentElement;

      // Calculate scroll amount
      const viewportH = window.innerHeight;
      const amount = px || Math.floor(viewportH * 0.85);

      switch (dir) {
        case "up":
          (sel ? el : window).scrollBy({ top: -amount, behavior: "smooth" });
          break;
        case "down":
          (sel ? el : window).scrollBy({ top: amount, behavior: "smooth" });
          break;
        case "top":
          (sel ? el : window).scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "bottom":
          (sel ? el : window).scrollTo({
            top: target.scrollHeight,
            behavior: "smooth",
          });
          break;
        default:
          (sel ? el : window).scrollBy({ top: amount, behavior: "smooth" });
      }

      return {
        scrollTop: target.scrollTop || window.scrollY,
        scrollHeight: target.scrollHeight,
        viewportHeight: viewportH,
      };
    },
    args: [dir, pixels || 0, selector || null],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return { scrolled: dir, ...results[0]?.result };
}

async function cmdClose() {
  const tab = await getActiveTab();
  await chrome.tabs.remove(tab.id);
  return { closed: true };
}

/**
 * Paste image into the active element via ClipboardEvent.
 * Works with contentEditable editors (X, 小红书, 即刻, etc.)
 */
async function cmdPasteImage({ base64, mimeType }) {
  if (!base64) throw new Error("base64 image data required");
  const mime = mimeType || "image/png";
  const tab = await getActiveTab();

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (b64, mime) => {
      // Convert base64 to Blob
      const byteChars = atob(b64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: mime });
      const file = new File([blob], `image.${mime.split("/")[1] || "png"}`, {
        type: mime,
      });

      // Create DataTransfer with the file
      const dt = new DataTransfer();
      dt.items.add(file);

      // Find the focused/active editable element
      let target = document.activeElement;
      if (!target || target === document.body) {
        // Try common editor selectors
        target =
          document.querySelector("[contenteditable=true]") ||
          document.querySelector("[data-testid=tweetTextarea_0]") ||
          document.querySelector("textarea") ||
          document.body;
      }

      // Dispatch paste event
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      const pasteHandled = !target.dispatchEvent(pasteEvent); // returns false if preventDefault() was called

      if (!pasteHandled) {
        // Try drop event as fallback
        const dropEvent = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        const dropHandled = !target.dispatchEvent(dropEvent);

        // Last resort: try setting input[type=file].files
        if (!dropHandled) {
          const fileInput = document.querySelector('input[type="file"]');
          if (fileInput) {
            const dt2 = new DataTransfer();
            dt2.items.add(file);
            fileInput.files = dt2.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            return { pasted: true, method: "file_input" };
          }
        }
      }

      return { pasted: true, method: pasteHandled ? "paste" : "drop" };
    },
    args: [base64, mime],
  });

  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result || { pasted: true };
}

/**
 * Export login state (cookies + localStorage) for the current tab's domain.
 * Returns Playwright-compatible storageState format.
 */
async function cmdSaveLogin({ name }) {
  if (!name) throw new Error("name required (e.g. 'xiaohongshu')");
  const tab = await getActiveTab();
  const url = new URL(tab.url);
  const domain = url.hostname;

  // 1. Get all cookies for this domain (including subdomains)
  const baseDomain = domain.split(".").slice(-2).join(".");
  const cookies = await chrome.cookies.getAll({ domain: baseDomain });

  // Convert to Playwright storageState cookie format
  const pwCookies = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expirationDate || -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite:
      {
        unspecified: "None",
        no_restriction: "None",
        lax: "Lax",
        strict: "Strict",
      }[c.sameSite] || "None",
  }));

  // 2. Get localStorage from the page
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const items = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        items[key] = localStorage.getItem(key);
      }
      return { origin: location.origin, items };
    },
  });

  const ls = results[0]?.result || { origin: url.origin, items: {} };

  // 3. Build Playwright storageState format
  const storageState = {
    cookies: pwCookies,
    origins: [
      {
        origin: ls.origin,
        localStorage: Object.entries(ls.items).map(([name, value]) => ({
          name,
          value,
        })),
      },
    ],
  };

  return { name, domain, storageState, cookieCount: pwCookies.length };
}

// ---------------------------------------------------------------------------
// Wait for element & batch execution
// ---------------------------------------------------------------------------

async function waitForSelector(selector, timeout = 5000) {
  const resolved = resolveSelector(selector);
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
      args: [resolved],
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

async function cmdBatch({ steps, auto_close }) {
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
  // Auto-close tab after batch completes (useful for scheduled tasks)
  if (auto_close) {
    try {
      await cmdClose();
      results.push({ step: "auto_close", action: "close", ok: true });
    } catch {
      // tab may already be closed
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
