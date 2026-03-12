#!/usr/bin/env python3
"""Playwright-based web page fetcher with JS rendering support."""

import argparse
import sys
import io
from urllib.parse import urlparse

# Force UTF-8 stdout on Windows (avoid GBK encoding errors)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ── Precise content selectors for known sites ──
# When matched, only extract content from these selectors (much cleaner).
SITE_SELECTORS: dict[str, str] = {
    "x.com": 'article[data-testid="tweet"]',
    "twitter.com": 'article[data-testid="tweet"]',
    "zhihu.com": "div.RichContent-inner, div.Post-RichText",
    "www.zhihu.com": "div.RichContent-inner, div.Post-RichText",
    "weibo.com": "div.detail_wbtext_4CRf9, div.Feed_body_3R0rO",
    "m.weibo.com": "div.weibo-text",
    "www.xiaohongshu.com": "div#detail-desc, div.note-content",
    "xiaohongshu.com": "div#detail-desc, div.note-content",
}

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


def fetch(
    url: str, scroll: bool = False, max_length: int = 10000, raw: bool = False
) -> str:
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
            # Layer 1: Generic cleanup (all sites)
            page.evaluate(GENERIC_CLEANUP_JS)

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

    if len(content) > max_length:
        content = (
            content[:max_length] + f"\n\n... (truncated, {len(content)} total chars)"
        )
    return content


def html_to_markdown(html: str) -> str:
    from markdownify import markdownify
    import re

    # Remove script/style/noscript/svg (may remain after DOM cleanup)
    for tag in ("script", "style", "noscript", "svg"):
        html = re.sub(rf"<{tag}[\s\S]*?</{tag}>", "", html, flags=re.IGNORECASE)

    md = markdownify(
        html, heading_style="ATX", strip=["img", "input", "button", "form"]
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
        "--max-length",
        type=int,
        default=10000,
        help="Max output length (default: 10000)",
    )
    parser.add_argument(
        "--raw", action="store_true", help="Output raw HTML instead of markdown"
    )
    args = parser.parse_args()

    result = fetch(
        args.url, scroll=args.scroll, max_length=args.max_length, raw=args.raw
    )
    print(result)


if __name__ == "__main__":
    main()
