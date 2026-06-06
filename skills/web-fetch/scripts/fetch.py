#!/usr/bin/env python3
"""Playwright-based web page fetcher with JS rendering support."""

import argparse
import json
import sys
import io
import os
import re
from urllib.parse import urlparse

# Force UTF-8 stdout on Windows (avoid GBK encoding errors)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ── Load site config from sites.json ──
SITE_CLEANUP_JS: dict[str, str] = {}
SITE_SELECTORS: dict[str, str] = {}


def _load_site_config():
    """Load site-specific selectors and cleanup JS from sites.json."""
    config_path = os.path.join(os.path.dirname(__file__), "..", "sites.json")
    if not os.path.exists(config_path):
        return
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception:
        return

    sites = config.get("sites", {})
    # Resolve $ref aliases
    for domain, cfg in sites.items():
        ref = cfg.get("$ref")
        if ref and ref in sites:
            cfg = sites[ref]
        if cfg.get("selector"):
            SITE_SELECTORS[domain] = cfg["selector"]
        if cfg.get("cleanupJs"):
            SITE_CLEANUP_JS[domain] = cfg["cleanupJs"]


_load_site_config()

# ── Generic noise removal JS — works on all sites ──
GENERIC_CLEANUP_JS = """
() => {
    // Remove semantic noise elements
    const selectors = [
        'nav', 'header', 'footer', 'aside', 'dialog',
        '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
        '[role="dialog"]', '[role="alertdialog"]',
        '[aria-label="cookie"]', '[class*="cookie"]', '[id*="cookie"]',
        '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
        '[class*="ad-"]', '[class*="ads-"]', '[class*="advert"]',
        '[class*="banner"]', '[id*="banner"]',
        '[class*="signup"]', '[class*="SignUp"]',
        '[class*="login"]', '[class*="Login"]',
        '[data-testid="loginButton"]', '[data-testid="signupButton"]',
    ];
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => el.remove());
    }
    // Remove hidden elements
    document.querySelectorAll('[aria-hidden="true"], [hidden]').forEach(el => el.remove());
}
"""


def is_feishu_doc_host(hostname: str) -> bool:
    """Return True for Feishu/Lark document hosts that render doc bodies virtually."""
    return (
        hostname == "feishu.cn"
        or hostname.endswith(".feishu.cn")
        or hostname == "larksuite.com"
        or hostname.endswith(".larksuite.com")
    )


def clean_feishu_text(text: str) -> str:
    text = text.replace("\u200b", "")
    text = text.replace("\ufeff", "")
    lines = [line.strip() for line in text.splitlines()]
    cleaned: list[str] = []
    blank = False
    for line in lines:
        if not line:
            if cleaned and not blank:
                cleaned.append("")
                blank = True
            continue
        cleaned.append(line)
        blank = False
    while cleaned and not cleaned[-1]:
        cleaned.pop()
    return "\n".join(cleaned)


def merge_visible_text_chunks(chunks: list[str]) -> str:
    """Merge virtual-scroll text snapshots while keeping first-seen order."""
    merged: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        cleaned = clean_feishu_text(chunk)
        if not cleaned:
            continue
        for line in cleaned.splitlines():
            normalized = re.sub(r"\s+", " ", line).strip()
            if not normalized:
                if merged and merged[-1]:
                    merged.append("")
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            merged.append(line.strip())
    while merged and not merged[-1]:
        merged.pop()
    return "\n".join(merged)


def feishu_text_to_markdown(text: str) -> str:
    lines = [line.strip() for line in clean_feishu_text(text).splitlines() if line.strip()]
    if not lines:
        return ""

    markdown: list[str] = []
    title = lines[0].lstrip("#").strip()
    markdown.append(f"# {title}")
    for line in lines[1:]:
        if line == title:
            continue
        markdown.append("")
        markdown.append(line)
    return "\n".join(markdown).strip()


def fetch_feishu_virtual_doc(page) -> str | None:
    """Extract Feishu/Lark docs rendered through virtual scrolling.

    The regular full-page HTML path often sees only the wiki shell or table of
    contents. The article body is mounted in #innerdocbody and changes as the
    scroll container advances, so collect snapshots across the document.
    """
    try:
        page.wait_for_selector("#innerdocbody", timeout=30000)
        page.wait_for_function(
            """() => {
                const el = document.querySelector('#innerdocbody');
                return el && (el.innerText || '').replace(/\u200b/g, '').trim().length > 300;
            }""",
            timeout=30000,
        )
    except Exception:
        return None

    chunks: list[str] = []
    stable_bottom_count = 0
    last_top = -1
    for _ in range(60):
        try:
            text = page.evaluate(
                "document.querySelector('#innerdocbody')?.innerText || ''"
            )
        except Exception:
            text = ""
        if text:
            chunks.append(text)

        metrics = page.evaluate(
            """() => {
                const scroller =
                    document.querySelector('.etherpad-container-wrapper') ||
                    document.querySelector('[data-testid="doc-scroll-container"]') ||
                    document.scrollingElement;
                if (!scroller) return { top: 0, height: 0, client: 0 };
                return {
                    top: scroller.scrollTop,
                    height: scroller.scrollHeight,
                    client: scroller.clientHeight
                };
            }"""
        )
        top = int(metrics.get("top") or 0)
        height = int(metrics.get("height") or 0)
        client = int(metrics.get("client") or 0)
        if height > 0 and client > 0 and top + client >= height - 8:
            stable_bottom_count += 1
            if stable_bottom_count >= 2:
                break
        else:
            stable_bottom_count = 0

        if top == last_top and height > 0:
            stable_bottom_count += 1
            if stable_bottom_count >= 3:
                break
        last_top = top

        page.evaluate(
            """() => {
                const scroller =
                    document.querySelector('.etherpad-container-wrapper') ||
                    document.querySelector('[data-testid="doc-scroll-container"]') ||
                    document.scrollingElement;
                if (!scroller) return;
                const delta = Math.max(480, Math.floor(scroller.clientHeight * 0.8));
                scroller.scrollBy(0, delta);
            }"""
        )
        page.wait_for_timeout(650)

    merged = merge_visible_text_chunks(chunks)
    if len(merged) < 1000:
        return None
    return feishu_text_to_markdown(merged)


def fetch(url: str, scroll: bool = False, raw: bool = False) -> str:
    from playwright.sync_api import sync_playwright

    hostname = urlparse(url).hostname or ""

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        # Hide webdriver flag
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = context.new_page()

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Wait for body to be available
            page.wait_for_selector("body", timeout=10000)
        except Exception as e:
            browser.close()
            return f"Error loading page: {e}"

        if scroll:
            # Scroll down to trigger lazy loading
            for _ in range(5):
                page.evaluate("window.scrollBy(0, window.innerHeight)")
                page.wait_for_timeout(800)
            # Scroll back to top
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(500)

        if raw:
            content = page.content()
        else:
            if is_feishu_doc_host(hostname):
                content = fetch_feishu_virtual_doc(page)
                if content:
                    browser.close()
                    return content

            # Layer 1: Generic cleanup (all sites)
            page.evaluate(GENERIC_CLEANUP_JS)

            # Layer 1.5: Site-specific cleanup (remove interactive noise)
            site_cleanup = SITE_CLEANUP_JS.get(hostname)
            if site_cleanup:
                page.evaluate(site_cleanup)

            # Layer 2: Precise selector extraction (known sites)
            site_selector = SITE_SELECTORS.get(hostname)
            if site_selector:
                extracted = page.evaluate(
                    """(selector) => {
                    const els = document.querySelectorAll(selector);
                    if (els.length === 0) return null;
                    return Array.from(els).map(el => el.innerHTML).join('<hr>');
                }""",
                    site_selector,
                )
                if extracted:
                    # Get page title for context
                    title = page.title() or ""
                    html = f"<h1>{title}</h1>{extracted}" if title else extracted
                    content = html_to_markdown(html)
                else:
                    # Selector didn't match — fall back to full page
                    content = html_to_markdown(page.content())
            else:
                content = html_to_markdown(page.content())

        browser.close()

    return content


def html_to_markdown(html: str) -> str:
    from markdownify import markdownify
    import re

    # Remove script/style/noscript/svg (may remain after DOM cleanup)
    for tag in ("script", "style", "noscript", "svg"):
        html = re.sub(rf"<{tag}[\s\S]*?</{tag}>", "", html, flags=re.IGNORECASE)

    # Remove interactive/noise elements before conversion
    for pattern in [
        r'<[^>]* role="group"[^>]*>[\s\S]*?</[^>]+>',
        r'<[^>]* data-testid="(?:like|unlike|retweet|reply|bookmark|share)"[^>]*/?>',
    ]:
        html = re.sub(pattern, "", html, flags=re.IGNORECASE)

    md = markdownify(
        html, heading_style="ATX", strip=["img", "input", "button", "form", "svg"]
    )

    # Collapse excessive blank lines
    md = re.sub(r"\n{3,}", "\n\n", md)
    # Strip leading/trailing whitespace per line
    lines = [line.strip() for line in md.split("\n")]
    # Remove empty lines at start/end
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Fetch web page with JS rendering")
    parser.add_argument("--url", required=True, help="URL to fetch")
    parser.add_argument(
        "--scroll", action="store_true", help="Scroll page to trigger lazy loading"
    )
    parser.add_argument(
        "--raw", action="store_true", help="Output raw HTML instead of markdown"
    )
    args = parser.parse_args()

    result = fetch(args.url, scroll=args.scroll, raw=args.raw)
    print(result)


if __name__ == "__main__":
    main()
