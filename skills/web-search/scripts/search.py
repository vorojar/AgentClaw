#!/usr/bin/env python3
"""Web search via SearXNG (self-hosted, free) with Serper API fallback."""

import argparse
import json
import os
import urllib.request
import urllib.error
import urllib.parse

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8888")
SERPER_URL = "https://google.serper.dev/search"


def search_searxng(query: str, max_results: int = 5) -> str | None:
    """Search via self-hosted SearXNG instance. Returns None on failure."""
    url = (
        f"{SEARXNG_URL}/search?q={urllib.parse.quote(query)}&format=json&language=zh-CN"
    )
    req = urllib.request.Request(url, headers={"Accept": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None

    lines = []

    # Answers (similar to Serper answerBox)
    for answer in data.get("answers", []):
        lines.append(f"Direct answer: {answer}")
        lines.append("")

    # Infoboxes (similar to Serper knowledgeGraph)
    for ib in data.get("infoboxes", []):
        title = ib.get("infobox", "")
        content = ib.get("content", "")
        if content:
            lines.append(f"{title}: {content[:300]}")
            lines.append("")

    # Results
    results = data.get("results", [])[:max_results]
    if not results and not lines:
        return None  # Empty results → fallback to Serper

    for i, item in enumerate(results, 1):
        lines.append(f"{i}. {item.get('title', '')}")
        lines.append(f"   {item.get('url', '')}")
        content = item.get("content")
        if content:
            lines.append(f"   {content}")
        lines.append("")

    return "\n".join(lines).strip() or None


def search_serper(query: str, max_results: int = 5) -> str:
    """Search via Google Serper API (paid fallback)."""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return "Error: No search backend available. Set SEARXNG_URL or SERPER_API_KEY."

    payload = json.dumps(
        {"q": query, "num": min(max_results, 10), "hl": "zh-cn"}
    ).encode()
    req = urllib.request.Request(
        SERPER_URL,
        data=payload,
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return f"Search API error ({e.code}): {e.read().decode()}"
    except Exception as e:
        return f"Search failed: {e}"

    lines = []

    # Answer box
    answer_box = data.get("answerBox", {})
    answer = answer_box.get("answer") or answer_box.get("snippet")
    if answer:
        lines.append(f"Direct answer: {answer}")
        lines.append("")

    # Knowledge graph
    kg = data.get("knowledgeGraph", {})
    if kg.get("description"):
        title = kg.get("title", "")
        lines.append(f"{title}: {kg['description']}")
        lines.append("")

    # Organic results
    items = data.get("organic", [])
    if not items and not lines:
        return f"No results found for: {query}"

    for i, item in enumerate(items, 1):
        lines.append(f"{i}. {item.get('title', '')}")
        lines.append(f"   {item.get('link', '')}")
        snippet = item.get("snippet")
        if snippet:
            lines.append(f"   {snippet}")
        lines.append("")

    return "\n".join(lines).strip()


def search(query: str, max_results: int = 5) -> str:
    """Search with SearXNG first, Serper as fallback."""
    # Try SearXNG (free, self-hosted)
    result = search_searxng(query, max_results)
    if result:
        return result

    # Fallback to Serper API (paid)
    return search_serper(query, max_results)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Web search (SearXNG + Serper fallback)"
    )
    parser.add_argument("query", help="Search query")
    parser.add_argument("--max", type=int, default=5, help="Max results (default 5)")
    args = parser.parse_args()

    result = search(args.query, args.max)
    print(result)
