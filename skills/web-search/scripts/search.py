#!/usr/bin/env python3
"""Web search via Google Serper API."""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

SERPER_URL = "https://google.serper.dev/search"


def search(query: str, max_results: int = 5) -> str:
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        print("Error: SERPER_API_KEY environment variable not set.", file=sys.stderr)
        sys.exit(1)

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
        print(f"Search API error ({e.code}): {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Search failed: {e}", file=sys.stderr)
        sys.exit(1)

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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Web search via Serper API")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--max", type=int, default=5, help="Max results (default 5)")
    args = parser.parse_args()

    result = search(args.query, args.max)
    print(result)
