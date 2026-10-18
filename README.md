# AI Engineering from Scratch, simply

A calm, one-route reader for [AI Engineering from Scratch](https://github.com/rohitg00/ai-engineering-from-scratch), the free, MIT-licensed course by Rohit Ghumare.

The original site is rich but hard to navigate when you are starting out.
This reader puts every part of the course into one order, from "Start here" to the last capstone, with a progress tracker and Previous / Next buttons.

## What is inside

- All 542 lessons in 20 phases, each with its full text, maths, diagrams and every code file.
- All 617 interactive figures from the lessons and 323 from the projects, using the course's own figure code.
- 392 lesson quizzes and 5 certification mock exams, answerable in the page.
- 79 projects, 4 manuals, 2 certification tracks (67 lessons), 51 cheatsheets, the glossary and 14 learning paths.
- A "Run it yourself" box on every lesson with the exact command to copy.
- A coverage check: every one of the course repo's 8,434 files is either shown in the reader or is website/tooling code, with 0 missing.

## Run it locally

```bash
git clone https://github.com/rohitg00/ai-engineering-from-scratch.git
git clone https://github.com/MANISH007700/ai-engineering-from-scratch-simple.git
cd ai-engineering-from-scratch-simple
python3 build.py          # indexes the course next door
python3 fetch_blogs.py    # optional: saves the author's blog posts for offline reading
python3 server.py         # opens http://127.0.0.1:8090
```

Only Python 3.10+ is needed.
Progress is saved in your browser.
After `git pull` in the course folder, run `python3 build.py` again to pick up new lessons.

## How it works

- `build.py` walks the course repo and writes `data/catalog.json` (the reading order) and `data/coverage.json` (the file check).
- `server.py` serves the reader, the course files under `/repo/`, and the course's own website files, so the interactive figures run unchanged.
- `static/` is the reader: plain HTML, CSS and JavaScript, with Marked, KaTeX, Mermaid, highlight.js and DOMPurify bundled for offline use.
- `python3 build.py --dist dist` builds a static copy for hosting. Netlify runs this (see `netlify.toml`), cloning the course at build time.

## Credits and licences

All course content, including the interactive figures, is by Rohit Ghumare under the [MIT licence](https://github.com/rohitg00/ai-engineering-from-scratch/blob/main/LICENSE).
The public build includes that licence as `COURSE-LICENSE.txt`.
Blog posts belong to the author's own site, so the public build links to them instead of copying them.
The reader code in this repo is MIT-licensed too (see `LICENSE`).
