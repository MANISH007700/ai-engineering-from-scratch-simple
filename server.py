"""Serves the simple reader on http://127.0.0.1:8090 (Python standard library only).

    python3 server.py

Routes:
  /             the reader            /reader/...   reader files (static/)
  /data/...     catalog and blogs     /repo/...     any file from the course repo (read-only)
  anything else falls back to the course's own website files (site/), so the original
  interactive figures and website pages work unchanged.
"""
import mimetypes
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
REPO = (HERE.parent / "ai-engineering-from-scratch").resolve()
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8090)

# Source files are shown as text, never executed or downloaded.
for ext in (".md", ".py", ".ts", ".go", ".rs", ".jl", ".sh", ".toml", ".yaml", ".yml", ".jsonl", ".txt", ".http",
            ".log", ".lua", ".tex", ".csv", ".tsv", ".sql", ".c", ".h", ".cpp", ".proto", ".ipynb"):
    mimetypes.add_type("text/plain; charset=utf-8", ext)
mimetypes.add_type("application/json; charset=utf-8", ".json")
mimetypes.add_type("text/javascript; charset=utf-8", ".js")


def inside(base: Path, sub: str) -> Path | None:
    """Resolve sub under base, refusing anything that escapes it or touches .git."""
    target = (base / sub).resolve()
    if base not in target.parents and target != base:
        return None
    if ".git" in target.relative_to(base).parts:
        return None
    return target if target.is_file() else None


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = unquote(urlsplit(path).path)
        if p in ("/", "/index.html"):
            return str(HERE / "static" / "index.html")
        for prefix, base in (("/reader/", HERE / "static"), ("/data/", HERE / "data"), ("/repo/", REPO)):
            if p.startswith(prefix):
                found = inside(base, p[len(prefix):])
                return str(found) if found else str(HERE / "missing")
        # Original website assets and pages (figures, styles, standalone pages), then repo content they fetch.
        found = inside(REPO / "site", p.lstrip("/")) or inside(REPO, p.lstrip("/"))
        return str(found) if found else str(HERE / "missing")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet


def main():
    if not REPO.exists():
        sys.exit(f"Course folder not found at {REPO}. Clone it next to this folder first.")
    if not (HERE / "data" / "catalog.json").exists():
        sys.exit("Run `python3 build.py` first.")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(HERE)))
    url = f"http://127.0.0.1:{PORT}/"
    print(f"AI Engineering from Scratch reader: {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
