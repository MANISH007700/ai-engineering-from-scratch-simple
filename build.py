"""Builds data/catalog.json (everything in the course, in one reading order) and
data/coverage.json (proof that every file in the course repo is accounted for).

    python3 build.py               # local reader: re-run after `git pull` in the course folder
    python3 build.py --dist dist   # also assemble a static public site in dist/ (used by Netlify)

The course repo is read from $COURSE_REPO, else ./course, else ../ai-engineering-from-scratch.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get("COURSE_REPO") or next(
    (p for p in (HERE / "course", HERE.parent / "ai-engineering-from-scratch") if p.exists()), HERE / "course")).resolve()
DATA = HERE / "data"

TEXT_EXT = {".md", ".py", ".ts", ".js", ".mjs", ".cjs", ".json", ".jsonl", ".txt", ".go", ".rs", ".jl", ".sh",
            ".toml", ".yaml", ".yml", ".html", ".css", ".csv", ".tsv", ".sql", ".c", ".h", ".cpp", ".lua",
            ".tex", ".ipynb", ".svg", ".http", ".log", ".env", ".example", ".cfg", ".ini", ".xml", ".proto",
            ".dockerfile", ".r", ".java", ".kt", ".swift", ".asm", ".s", ".mod", ".sum", ".lock", ".tsx", ".jsx"}

# Files that make the website or the course tooling work, but are not lessons to read.
RUNTIME_PREFIXES = ("site/", "api/", "lib/", "scripts/", ".github/", ".claude/", "book/", "web/", "assets/",
                    "vercel.json", "languages.json", "requirements.txt", ".gitignore", ".gitattributes",
                    ".nvmrc", ".editorconfig", "manuals/_shared/", "projects/_template/")
RUNNERS = {".py": "python3 {p}", ".ts": "node {p}", ".mjs": "node {p}", ".js": "node {p}", ".go": "go run {p}",
           ".jl": "julia {p}", ".sh": "bash {p}", ".rs": "rustc {p} -o /tmp/lesson && /tmp/lesson"}


def rel(p: Path) -> str:
    return p.relative_to(REPO).as_posix()


def files_under(folder: Path) -> list[str]:
    return sorted(rel(f) for f in folder.rglob("*") if f.is_file() and ".git" not in f.parts)


def title_of(md: Path, fallback: str) -> str:
    if md.exists():
        for line in md.read_text(errors="ignore").splitlines():
            if line.startswith("# "):
                return re.sub(r"[*`]", "", line[2:]).strip()
    return fallback


def humanize(slug: str) -> str:
    return re.sub(r"^\d+[-_]?", "", slug).replace("-", " ").replace("_", " ").strip().capitalize()


def lesson_meta(md: Path) -> dict:
    meta = {}
    if md.exists():
        head = md.read_text(errors="ignore")[:3000]
        for key in ("Type", "Language", "Languages", "Prerequisites", "Time"):
            m = re.search(rf"\*\*{key}:\*\*\s*(.+)", head)
            if m:
                meta[key.lower().rstrip("s") if key == "Languages" else key.lower()] = m.group(1).strip()
    minutes = 0
    if t := meta.get("time"):
        if m := re.search(r"(\d+(?:\.\d+)?)\s*(hour|hr|h)\b", t, re.I):
            minutes = float(m.group(1)) * 60
        elif m := re.search(r"(\d+)\s*min", t, re.I):
            minutes = int(m.group(1))
    meta["minutes"] = int(minutes)
    return meta


def run_commands(files: list[str]) -> list[str]:
    cmds = []
    for f in files:
        if "/code/" in f or "/solution/" in f:
            ext = Path(f).suffix
            if ext in RUNNERS and not f.endswith((".test.ts", "_test.py")):
                cmds.append(RUNNERS[ext].format(p=f))
    return cmds


def lesson_item(folder: Path, kind: str, number: str) -> dict:
    doc = folder / "docs" / "en.md"
    files = files_under(folder)
    text = doc.read_text(errors="ignore") if doc.exists() else ""
    return {
        "id": rel(folder), "kind": kind, "number": number,
        "title": title_of(doc, humanize(folder.name)),
        "docs": [rel(doc)] if doc.exists() else [],
        "quiz": rel(folder / "quiz.json") if (folder / "quiz.json").exists() else None,
        "files": files, "meta": lesson_meta(doc), "run": run_commands(files),
        "figures": len(re.findall(r"^```figure", text, re.M)),
    }


def doc_item(path: Path, kind: str, title: str | None = None) -> dict:
    return {"id": rel(path), "kind": kind, "title": title or title_of(path, humanize(path.stem)),
            "docs": [rel(path)], "files": [rel(path)], "meta": {}, "run": [], "quiz": None, "figures": 0}


def phases() -> list[dict]:
    sections = []
    for phase in sorted((REPO / "phases").iterdir()):
        if not phase.is_dir():
            continue
        lessons = [p for p in sorted(phase.iterdir()) if p.is_dir() and re.match(r"\d", p.name)]
        n = int(phase.name[:2])
        readme = phase / "README.md"
        items = []
        if readme.exists():
            items.append(doc_item(readme, "intro", f"Phase {n} overview"))
        items += [lesson_item(p, "lesson", f"{n}.{i}") for i, p in enumerate(lessons, 1)]
        extra = [rel(f) for f in phase.iterdir() if f.is_file() and f.name != "README.md"]
        if extra:
            items[0]["files"] = sorted(set(items[0]["files"]) | set(extra))
        sections.append({"id": f"phase-{n:02d}", "group": "Course",
                         "title": f"Phase {n} · {title_of(readme, humanize(phase.name)).split(':', 1)[-1].strip()}",
                         "items": items})
    return sections


def projects() -> dict:
    items = []
    for p in sorted((REPO / "projects").iterdir()):
        if not p.is_dir() or p.name.startswith("_"):
            continue
        if not (p / "project.json").exists():  # notes folders such as projects/validation
            files = files_under(p)
            items.append({"id": rel(p), "kind": "guide", "title": f"Project notes: {humanize(p.name)}",
                          "docs": [f for f in files if f.endswith(".md")], "files": files, "quiz": None,
                          "figures": 0, "run": [], "meta": {"minutes": 0}})
            continue
        meta = json.loads((p / "project.json").read_text())
        docs = [rel(p / "README.md")] if (p / "README.md").exists() else []
        for stage in sorted((p / "stages").glob("*")) if (p / "stages").exists() else []:
            for d in (stage / "docs" / "en.md", stage / "starter" / "STAGE.md"):
                if d.exists():
                    docs.append(rel(d))
        files = files_under(p)
        items.append({"id": rel(p), "kind": "project", "title": meta.get("title", humanize(p.name)),
                      "docs": docs, "files": files, "quiz": None, "figures": 0,
                      "meta": {"level": meta.get("levelName", ""), "summary": meta.get("tagline", ""),
                               "minutes": 0},
                      "run": [f"python3 scripts/project_test.py {p.name} --init learning-artifacts/{p.name}",
                              f"python3 scripts/project_test.py {p.name} --all --path learning-artifacts/{p.name} --strict"]})
    items.sort(key=lambda i: (str(json.loads((REPO / i["id"] / "project.json").read_text()).get("level", 9))
                              if (REPO / i["id"] / "project.json").exists() else "9", i["title"]))
    guide = [doc_item(f, "guide") for f in sorted((REPO / "projects").glob("*.md"))]
    guide[0]["files"] += [rel(f) for f in (REPO / "projects").glob("*.json")]
    return {"id": "projects", "group": "Practice", "title": f"Projects ({len(items)})", "items": guide + items}


def manuals() -> dict:
    items = []
    for m in sorted((REPO / "manuals").iterdir()):
        if not m.is_dir() or m.name.startswith("_"):
            continue
        spec = json.loads((m / "manual.json").read_text())
        docs = [rel(m / spec.get("front", "front.md"))] if (m / spec.get("front", "front.md")).exists() else []
        for part in spec.get("parts", []) + ([spec["reference"]] if spec.get("reference") else []):
            docs += [rel(m / s["file"]) for s in part.get("sections", []) if (m / s["file"]).exists()]
        items.append({"id": rel(m), "kind": "manual", "title": spec.get("title", m.name), "docs": docs,
                      "files": files_under(m), "quiz": None, "figures": 0, "run": [],
                      "meta": {"summary": spec.get("summary", ""), "minutes": 0}})
    guide = [doc_item(f, "guide") for f in sorted((REPO / "manuals").glob("*.md"))]
    guide[0]["files"] += [rel(f) for f in (REPO / "manuals").glob("*.json")]
    return {"id": "manuals", "group": "Deep dives", "title": f"Manuals ({len(items)})", "items": guide + items}


def certifications() -> list[dict]:
    out = []
    for prog in sorted(p for p in (REPO / "certifications").iterdir() if p.is_dir()):
        spec = json.loads((prog / "program.json").read_text())
        items = [doc_item(f, "guide") for f in (prog / "README.md", prog / "GETTING_STARTED.md") if f.exists()]
        # Program-level files plus every folder that is not a lesson or an assessment (tracks, research, references)
        other = [f for d in prog.iterdir() if d.is_dir() and d.name not in ("lessons", "assessments")
                 for f in files_under(d)]
        items[0]["files"] = sorted(set(items[0]["files"]) | {rel(f) for f in prog.iterdir() if f.is_file()} | set(other))
        lessons = sorted(p for p in (prog / "lessons").iterdir() if p.is_dir())
        items += [lesson_item(p, "lesson", f"{i}") for i, p in enumerate(lessons, 0)]
        for a in sorted((prog / "assessments").iterdir()) if (prog / "assessments").exists() else []:
            files = files_under(a) if a.is_dir() else [rel(a)]
            docs = [f for f in files if f.endswith(".md")]
            items.append({"id": rel(a), "kind": "assessment", "title": f"Assessment: {a.name.upper()}",
                          "docs": docs, "files": files, "quiz": None, "figures": 0, "run": [], "meta": {"minutes": 0}})
        out.append({"id": f"cert-{prog.name}", "group": "Certifications", "title": spec.get("name", prog.name),
                    "items": items})
    readme = REPO / "certifications" / "README.md"
    if readme.exists():
        out[0]["items"].insert(0, doc_item(readme, "guide", "About the certifications"))
    return out


def learning_paths() -> dict:
    items = []
    for f in sorted((REPO / "learning-paths").iterdir()):
        if f.suffix == ".json":
            spec = json.loads(f.read_text())
            steps = [{"path": s.get("path"), "title": s.get("title"), "minutes": s.get("minutes"),
                      "checkpoint": s.get("checkpoint")}
                     for s in spec.get("lessons", []) + spec.get("optionalLessons", []) if isinstance(s, dict)]
            if not steps:  # other path files list lessons under different keys: collect every lesson path
                found = re.findall(r'"(phases/[0-9][^"]+)"', f.read_text())
                steps = [{"path": p, "title": None} for p in dict.fromkeys(found)]
            items.append({"id": rel(f), "kind": "path", "title": spec.get("title", humanize(f.stem)),
                          "docs": [], "files": [rel(f)], "quiz": None, "figures": 0, "run": [],
                          "meta": {"summary": spec.get("summary", ""), "minutes": spec.get("estimatedMinutes", 0)},
                          "steps": steps})
        else:
            items.append(doc_item(f, "guide"))
    return {"id": "paths", "group": "Start here", "title": "Learning paths (shortcuts)", "items": items}


def simple_section(sid, group, title, folder: Path, kind="doc", pattern="*.md") -> dict:
    items = [doc_item(f, kind) for f in sorted(folder.rglob(pattern)) if f.is_file()]
    return {"id": sid, "group": group, "title": title, "items": items}


def skills() -> dict:
    items = []
    for s in sorted((REPO / "skills").iterdir()):
        if s.is_dir():
            files = files_under(s)
            items.append({"id": rel(s), "kind": "skill", "title": s.name,
                          "docs": [f for f in files if f.endswith("SKILL.md")] or [f for f in files if f.endswith(".md")][:1],
                          "files": files, "quiz": None, "figures": 0, "run": [], "meta": {"minutes": 0}})
    return {"id": "skills", "group": "Extras", "title": "AI tutor skills", "items": items}


def outputs() -> dict:
    files = files_under(REPO / "outputs")
    return {"id": "outputs", "group": "Extras", "title": "Reusable outputs (prompts, agents, MCP servers)",
            "items": [{"id": "outputs", "kind": "files", "title": "Everything in outputs/", "docs": [],
                       "files": files, "quiz": None, "figures": 0, "run": [], "meta": {"minutes": 0}}]}


def start_here() -> dict:
    items = [doc_item(REPO / "README.md", "guide", "Course README (read this first)")]
    for name, title in (("ROADMAP.md", "Roadmap: every phase and lesson"), ("LESSON_TEMPLATE.md", "How every lesson is built"),
                        ("glossary/terms.md", "Glossary: terms"), ("glossary/myths.md", "Glossary: common myths"),
                        ("glossary/README.md", "About the glossary")):
        if (REPO / name).exists():
            items.append(doc_item(REPO / name, "guide", title))
    return {"id": "start", "group": "Start here", "title": "Start here", "items": items}


def repo_docs() -> dict:
    names = ["CONTRIBUTING.md", "FORKING.md", "AGENTS.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "SPONSORS.md",
             "BACKERS.md", "LICENSE", "docs/i18n.md", "docs/portfolio-writing-sync.md", "book/README.md"]
    items = [doc_item(REPO / n, "doc") for n in names if (REPO / n).exists()]
    items += [doc_item(f, "doc", f"README in {f.parent.name}") for f in sorted((REPO / "i18n").rglob("*.md"))]
    return {"id": "repo", "group": "Extras", "title": "About the repo and translations", "items": items}


SITE_PAGES = ["how-to-learn", "inside-an-ai-agent", "learning-paths", "roadmap", "catalog", "glossary", "skills",
              "prereqs", "certifications", "projects", "about", "developer", "sponsors", "contact", "privacy"]


def site_pages() -> dict:
    items = []
    for name in SITE_PAGES:
        f = REPO / "site" / f"{name}.html"
        if f.exists():
            t = re.search(r"<title>(.*?)</title>", f.read_text(errors="ignore"), re.S)
            items.append({"id": f"site/{name}.html", "kind": "page", "title": (t.group(1).split("|")[0].strip() if t else name),
                          "page": f"/{name}.html", "docs": [], "files": [f"site/{name}.html"], "quiz": None,
                          "figures": 0, "run": [], "meta": {"minutes": 0}})
    return {"id": "site", "group": "Extras", "title": "Original website pages", "items": items}


def blogs() -> dict:
    index = DATA / "blogs" / "index.json"
    feed = json.loads(index.read_text()) if index.exists() else []
    items = [{"id": f"blog:{b['slug']}", "kind": b["kind"], "title": b["title"], "blog": b["slug"], "url": b["url"],
              "docs": [], "files": [], "quiz": None, "figures": 0, "run": [],
              "meta": {"summary": b.get("description", ""), "date": b.get("date", ""), "minutes": 0}} for b in feed]
    return {"id": "blogs", "group": "Extras", "title": f"Blog posts and guides ({len(items)})", "items": items}


def coverage(sections: list[dict]) -> dict:
    shown = set()
    for s in sections:
        for it in s["items"]:
            shown.update(it["files"])
            shown.update(it["docs"])
    all_files = [rel(f) for f in REPO.rglob("*") if f.is_file() and ".git" not in f.relative_to(REPO).parts[:1]]
    report = {"content_shown": 0, "website_and_tooling": 0, "missing": []}
    for f in all_files:
        if f in shown:
            report["content_shown"] += 1
        elif f.startswith(RUNTIME_PREFIXES) or "/" not in f or f.endswith((".gitkeep", ".sha256")):
            report["website_and_tooling"] += 1
        else:
            report["missing"].append(f)
    report["total_files"] = len(all_files)
    return report


def main():
    DATA.mkdir(exist_ok=True)
    sections = [start_here(), learning_paths(), *phases(), projects(), manuals(), *certifications(),
                simple_section("cheatsheets", "Revision", "Cheatsheets", REPO / "cheatsheets", "cheatsheet"),
                blogs(), site_pages(), skills(), outputs(), repo_docs()]
    commit = subprocess.run(["git", "-C", str(REPO), "log", "-1", "--format=%h %cs"], capture_output=True, text=True).stdout.strip()
    lessons = [i for s in sections if s["id"].startswith("phase-") for i in s["items"] if i["kind"] == "lesson"]
    catalog = {"commit": commit, "sections": sections,
               "stats": {"lessons": len(lessons), "quizzes": sum(1 for i in lessons if i["quiz"]),
                         "figures": sum(i["figures"] for s in sections for i in s["items"]),
                         "minutes": sum(i["meta"].get("minutes", 0) for i in lessons),
                         "items": sum(len(s["items"]) for s in sections)}}
    (DATA / "catalog.json").write_text(json.dumps(catalog))
    cov = coverage(sections)
    (DATA / "coverage.json").write_text(json.dumps(cov, indent=1))
    print(f"commit {commit}: {catalog['stats']}")
    print(f"files: {cov['total_files']} total, {cov['content_shown']} shown in the reader, "
          f"{cov['website_and_tooling']} website/tooling, {len(cov['missing'])} missing")
    for f in cov["missing"][:40]:
        print("  MISSING", f)
    if "--dist" in sys.argv:
        dist(Path(sys.argv[sys.argv.index("--dist") + 1]).resolve(), catalog, cov)


# Top-level course folders the original website pages fetch with relative paths.
CONTENT_DIRS = ["phases", "projects", "manuals", "certifications", "cheatsheets", "glossary", "learning-paths",
                "skills", "outputs", "i18n"]


def dist(out: Path, catalog: dict, cov: dict) -> None:
    """A static copy of the reader for public hosting. Blog posts belong to the author's own site, so the
    public build links to them instead of re-hosting them."""
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(REPO / "site", out, ignore=shutil.ignore_patterns("index.html", "test_*", "*.test.js"))
    shutil.copytree(HERE / "static", out / "reader")
    shutil.copy(HERE / "static" / "index.html", out / "index.html")
    for s in catalog["sections"]:
        for it in s["items"]:
            it.pop("blog", None)
            for f in it["files"] + it["docs"]:
                src, dst = REPO / f, out / "repo" / f
                if src.is_file() and not dst.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
    catalog["public"] = True
    (out / "data").mkdir()
    (out / "data" / "catalog.json").write_text(json.dumps(catalog))
    (out / "data" / "coverage.json").write_text(json.dumps(cov))
    shutil.copy(REPO / "LICENSE", out / "COURSE-LICENSE.txt")
    (out / "_redirects").write_text("".join(f"/{d}/* /repo/{d}/:splat 200\n" for d in CONTENT_DIRS))
    (out / "_headers").write_text("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n")
    files = sum(1 for _ in out.rglob("*") if _.is_file())
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"dist: {files} files, {size / 1e6:.0f} MB in {out}")


if __name__ == "__main__":
    main()
