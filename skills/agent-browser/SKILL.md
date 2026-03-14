---
name: agent-browser
description: 浏览器自动化：自动连接用户真实 Chrome（含全部登录态），无 Chrome 时回退无头模式。支持截图、表单、抓取 | Browser automation — auto-attaches to user's real Chrome (with all logins), falls back to headless
---

Rust-native browser CLI. **Auto-connects to user's Chrome** (via CDP on port 9222) when available — full login state, zero extensions. Falls back to headless mode when Chrome is not running.

> The wrapper `ab.mjs` handles this automatically. Just run commands — it will connect to Chrome if possible.
> **Never use `close`** — it would kill the user's Chrome. Use `tab close <id>` to close specific tabs.

## Quick Start

```bash
agent-browser open <url>
agent-browser snapshot          # Accessibility tree with @refs (best for AI)
agent-browser click @e2         # Click by ref
agent-browser fill @e3 "value"  # Clear + fill by ref
agent-browser screenshot $WORKDIR/out.png
agent-browser close
```

## Workflow: snapshot → act → verify

1. `snapshot` — see all interactive elements with refs
2. Act using refs (`click @e1`, `fill @e2 "text"`, `select @e3 "option"`)
3. `snapshot` again to verify changes

## Core Commands

### Navigation
```bash
agent-browser open <url>           # Navigate (aliases: goto, navigate)
agent-browser back / forward       # History navigation
agent-browser reload
agent-browser url                  # Print current URL
agent-browser title                # Print page title
```

### Reading
```bash
agent-browser snapshot             # Accessibility tree with refs (preferred)
agent-browser get text <sel>       # Get element text
agent-browser get html <sel>       # Get innerHTML
agent-browser get value <sel>      # Get input value
agent-browser get attr <sel> <attr> # Get attribute
```

### Interaction
```bash
agent-browser click <sel>          # Click (--new-tab to open in new tab)
agent-browser dblclick <sel>       # Double-click
agent-browser fill <sel> <text>    # Clear + fill input
agent-browser type <sel> <text>    # Type into element (append)
agent-browser press <key>          # Press key (Enter, Tab, Escape, Control+a)
agent-browser select <sel> <val>   # Select dropdown option
agent-browser check <sel>          # Check checkbox
agent-browser uncheck <sel>        # Uncheck checkbox
agent-browser hover <sel>          # Hover element
agent-browser scroll <sel>         # Scroll element into view
agent-browser upload <sel> <file>  # Upload file
```

### Semantic Locators (alternative to refs)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign in" click
agent-browser find label "Email" fill "test@test.com"
agent-browser find placeholder "Search..." fill "query"
```

### Screenshots & PDF
IMPORTANT: Always use `$WORKDIR/filename` for output paths so files land in the session directory.
```bash
agent-browser screenshot $WORKDIR/page.png              # Page screenshot
agent-browser screenshot $WORKDIR/page.png --fullpage   # Full page
agent-browser screenshot $WORKDIR/page.png --annotate   # With element labels
agent-browser screenshot $WORKDIR/page.png --selector <sel>  # Element only
agent-browser pdf $WORKDIR/doc.pdf                      # Save as PDF
```

### Wait
```bash
agent-browser wait <sel>             # Wait for element (default 10s)
agent-browser wait <sel> --timeout 30000
agent-browser wait url <pattern>     # Wait for URL match
agent-browser wait load              # Wait for page load
agent-browser wait idle              # Wait for network idle
```

### Tabs
```bash
agent-browser tabs                   # List all tabs
agent-browser tab <id>               # Switch to tab
agent-browser tab new [url]          # Open new tab
agent-browser tab close [id]         # Close tab
```

### JavaScript
```bash
agent-browser eval "<expression>"    # Evaluate JS, returns result
```

### Network
```bash
agent-browser network               # View network requests
agent-browser network --clear       # Clear log
agent-browser intercept <pattern> --body "<json>"  # Mock responses
agent-browser block <pattern>       # Block requests
```

### Console & Errors
```bash
agent-browser console               # View console messages
agent-browser console --errors      # Errors only
agent-browser errors                # Uncaught exceptions
```

### Cookies & Storage
```bash
agent-browser cookies               # Get all cookies
agent-browser cookies set <name> <val>
agent-browser cookies clear
agent-browser storage local          # Get all localStorage
agent-browser storage local <key>
agent-browser storage local set <k> <v>
agent-browser storage session        # sessionStorage
```

### Device Emulation
```bash
agent-browser set viewport <w> <h>   # Set viewport size
agent-browser set device "iPhone 15"  # Emulate device
agent-browser set offline true        # Offline mode
agent-browser set media dark          # Dark mode
agent-browser set geolocation <lat> <lon>
```

## Authentication & Persistence

### Save/load login state
```bash
# Method 1: State files
agent-browser state save ./auth.json     # Save cookies + localStorage
agent-browser --state ./auth.json open <url>  # Reuse saved state

# Method 2: Session name (auto-persist)
agent-browser --session-name myapp open <url>  # Auto-saves on close

# Method 3: Persistent profile (full browser state)
agent-browser --profile ./my-profile open <url>
```

### Import from user's Chrome
```bash
# User launches Chrome with: chrome --remote-debugging-port=9222
agent-browser --auto-connect state save ./auth.json
# Now use ./auth.json for future headless sessions
```

## Tips

- **Always use `snapshot`** first — refs are the most reliable selectors
- **Refs reset on navigation** — run `snapshot` again after `open` or page change
- Use `--state` or `--session-name` to persist login across runs
- **File output must use `$WORKDIR`**: e.g. `agent-browser screenshot $WORKDIR/page.png`. `$WORKDIR` points to the per-session temp directory (`data/tmp/{sessionId}/`), where files are auto-served via `/files/`. Never use bare relative paths — they save to the wrong location.
- Results from `shell` tool are returned directly to you
