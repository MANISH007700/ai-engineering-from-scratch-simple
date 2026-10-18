"""Saves the blog posts and guides that aiengineeringfromscratch.com lists (they live on the
author's site, rohitghumare.com) into data/blogs/, so they can be read offline.

    python3 fetch_blogs.py      # polite: one request at a time, half a second apart
"""
import json
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

SOURCE = "https://rohitghumare.com"
OUT = Path(__file__).resolve().parent / "data" / "blogs"


def get(url: str, accept: str) -> str:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "ai-course-reader (personal offline copy)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def article_body(html: str, url: str) -> str:
    m = re.search(r"<article\b[^>]*>(.*)</article>", html, re.S)
    body = m.group(1) if m else html
    body = re.sub(r"<(script|style|noscript|iframe|form)\b.*?</\1>", "", body, flags=re.S | re.I)
    body = re.sub(r"<(nav|header|footer)\b.*?</\1>", "", body, flags=re.S | re.I)
    # Make every link and image absolute, so they keep working outside the original site.
    return re.sub(r'\b(href|src)="(?!https?:|mailto:|data:|#)([^"]*)"',
                  lambda m: f'{m.group(1)}="{urljoin(url, m.group(2))}"', body).strip()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    feed = json.loads(get(f"{SOURCE}/api/content", "application/json"))
    index = []
    for item in feed["items"]:
        slug = item["id"].strip("/").replace("/", "--")
        path = OUT / f"{slug}.html"
        if not path.exists():
            path.write_text(article_body(get(item["url"], "text/html"), item["url"]))
            time.sleep(0.5)
        index.append({"slug": slug, "kind": item.get("kind", "blog"), "title": item["title"], "url": item["url"],
                      "description": item.get("description", ""), "date": item.get("datePublished", "")})
        print(f"ok  {slug}")
    index.sort(key=lambda b: b["date"], reverse=True)
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    print(f"{len(index)} articles saved to {OUT}")


if __name__ == "__main__":
    main()
