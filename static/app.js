// AI Engineering from Scratch, simply: a calm reader for the whole course.
// Everything comes from the cloned course repo (/repo/...) and data/catalog.json, built by build.py.
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const main = $("#main");
let catalog, order = [], byId = new Map(), sectionOf = new Map();

// ---------- progress (kept in this browser) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: progress lasts this visit */ } },
};
const done = new Set(store.get("aifs.done", []));
const saveDone = () => store.set("aifs.done", [...done]);

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}
const toast = (msg) => { const t = h("div", { class: "toast" }, msg); document.body.append(t); setTimeout(() => t.remove(), 1600); };
const fmtMin = (m) => (m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`);
const lessons = () => order.filter((i) => i.kind === "lesson" && sectionOf.get(i.id).id.startsWith("phase-"));

// ---------- markdown ----------
function slug(text) { return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"); }
function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// If text between dollar signs is not valid TeX (e.g. JSON Schema's $ref ... $defs), it was never maths: show it as written.
function tex(src, display, raw) {
  try { return katex.renderToString(src, { displayMode: display, throwOnError: true, strict: "ignore" }); }
  catch { return raw ? esc(raw) : `<pre><code>${esc(src)}</code></pre>`; }
}

let mdContext = { dir: "", manual: null };
marked.use({
  gfm: true,
  extensions: [
    { name: "blockMath", level: "block", start: (s) => s.match(/^\$\$/m)?.index,
      tokenizer(src) { const m = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$[ \t]*(?:\n|$)/.exec(src); if (m) return { type: "blockMath", raw: m[0], text: m[1] }; },
      renderer: (t) => tex(t.text, true) },
    { name: "inlineMath", level: "inline", start: (s) => s.indexOf("$"),
      tokenizer(src) {
        const m = /^\$`([^`]+)`\$/.exec(src) || /^\$\$([^$\n]+?)\$\$/.exec(src) || /^\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\w$])/.exec(src);
        if (m) return { type: "inlineMath", raw: m[0], text: m[1], display: m[0].startsWith("$$") };
      },
      renderer: (t) => tex(t.text, t.display, t.raw) },
    { name: "cite", level: "inline", start: (s) => s.indexOf("{{"),
      tokenizer(src) { const m = /^\{\{([a-z]+ [^}]{1,120})\}\}/.exec(src); if (m) return { type: "cite", raw: m[0], text: m[1] }; },
      renderer: (t) => `<span class="cite" title="Source reference">${esc(t.text)}</span>` },
  ],
  renderer: {
    code(code, info) {
      const lang = (info || "").trim().split(/\s+/)[0];
      if (lang === "math") return tex(code, true);
      if (lang === "mermaid") return `<pre class="mermaid">${esc(code)}</pre>`;
      if (lang === "figure") return figureBlock(code);
      const cls = lang && hljs.getLanguage(lang) ? ` class="language-${lang}"` : "";
      return `<pre><code${cls}>${esc(code)}</code></pre>`;
    },
    heading(text, level) { return `<h${level} id="${slug(text)}">${text}</h${level}>`; },
  },
});

// ```figure blocks: a lesson figure is just a name ("gradient-descent"); a manual figure is "id: fig-x" plus fields.
function figureBlock(code) {
  const fields = Object.fromEntries(code.split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  if (fields.id && mdContext.manual) {
    return `<figure class="manual-fig" id="${esc(fields.id)}"><img src="/repo/${mdContext.manual}/figures/${esc(fields.id)}.svg" alt="${esc(fields.title || fields.id)}" loading="lazy">` +
      `<figcaption>${fields.title ? `<b>${esc(fields.title)}.</b> ` : ""}${esc(fields.caption || fields.claim || "")}</figcaption></figure>`;
  }
  return `<div class="lesson-figure" data-figure="${esc(code.trim())}"></div>`;
}

function renderMarkdown(text, docPath, item) {
  mdContext = { dir: docPath.split("/").slice(0, -1).join("/"), manual: item.kind === "manual" ? item.id : null };
  const html = DOMPurify.sanitize(marked.parse(text.replace(/^---\n[\s\S]*?\n---\n/, "")), { ADD_ATTR: ["data-figure", "target"] });
  const box = h("div", { class: "md", "data-dir": mdContext.dir, html });
  // A bare <image> placeholder in prose parses as an empty <img>; show the word the author wrote instead.
  box.querySelectorAll("img:not([src])").forEach((n) => n.replaceWith("<image>"));
  fixLinks(box, mdContext.dir);
  return box;
}

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
  return out.join("/");
}

// Turn repo-relative links and images into reader links, so nothing points at a broken path.
function itemFor(path) {
  path = path.replace(/\/$/, "");
  if (byId.has(path)) return byId.get(path);
  const m = path.match(/^(.*)\/docs\/en\.md$/) || path.match(/^(.*)\/README\.md$/);
  if (m && byId.has(m[1])) return byId.get(m[1]);
  return order.find((i) => i.docs.includes(path));
}
function fixLinks(root, dir) {
  root.querySelectorAll("img[src], source[srcset]").forEach((n) => {
    const attr = n.hasAttribute("src") ? "src" : "srcset";
    const v = n.getAttribute(attr);
    if (!/^(https?:|data:|\/)/.test(v)) n.setAttribute(attr, "/repo/" + normalize(`${dir}/${v.split(" ")[0]}`));
  });
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href.startsWith("#")) return;
    const site = href.match(/^https?:\/\/aiengineeringfromscratch\.com\/lesson(?:\.html)?\?path=([^&#]+)/);
    if (site) { const it = itemFor(decodeURIComponent(site[1])); if (it) { a.href = `#/i/${encodeURIComponent(it.id)}`; return; } }
    if (/^(https?:|mailto:)/.test(href)) { a.target = "_blank"; a.rel = "noopener"; return; }
    const [path, hash] = href.split("#");
    const resolved = normalize(`${dir}/${path}`);
    const it = itemFor(resolved);
    if (it) a.href = `#/i/${encodeURIComponent(it.id)}${hash ? "/" + hash : ""}`;
    else { a.href = "/repo/" + resolved; a.target = "_blank"; }
  });
}

const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve) => {
      const s = h("script", { src });
      s.onload = resolve;
      s.onerror = resolve; // a missing figure file leaves the figure out; the text still shows
      document.head.append(s);
    }));
  }
  return loadedScripts.get(src);
}

async function hydrate(root, item) {
  // Code that already carries markup (blog posts) is highlighted at the source; only plain code is highlighted here.
  root.querySelectorAll("pre code").forEach((c) => { if (!c.dataset.highlighted && !c.childElementCount) hljs.highlightElement(c); });
  if (item?.kind === "project" && root.querySelector('.lesson-figure[data-figure^="pj-"]')) {
    await loadScript("/figures/projects/runtime.js");
    await loadScript(`/figures/projects/${item.id.split("/").pop()}.js`);
  }
  const graphs = root.querySelectorAll("pre.mermaid");
  if (graphs.length) {
    mermaid.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default", securityLevel: "strict" });
    try { await mermaid.run({ nodes: graphs, suppressErrors: true }); } catch { /* a broken diagram stays as text */ }
  }
  if (root.querySelector(".lesson-figure") && window.AIFS_loadFigureProviders) {
    await window.AIFS_loadFigureProviders(root);
    window.mountLessonFigures(root);
  }
}

// ---------- outline ----------
function renderOutline(current) {
  const nav = $("#outline");
  nav.replaceChildren();
  let group = null;
  for (const s of catalog.sections) {
    if (!s.items.length) continue;
    if (s.group !== group) { group = s.group; nav.append(h("div", { class: "group-title" }, group)); }
    const n = s.items.length, d = s.items.filter((i) => done.has(i.id)).length;
    const det = h("details", {}, h("summary", {}, h("span", {}, s.title), h("span", { class: `count${d === n ? " full" : ""}` }, `${d}/${n}`)));
    if (current && sectionOf.get(current.id) === s) det.open = true;
    const ol = h("ol");
    det.addEventListener("toggle", () => { if (det.open && !ol.children.length) fill(); }, { once: false });
    const fill = () => {
      for (const it of s.items) {
        const btn = h("button", { class: it === current ? "current" : "", onclick: () => go(it) },
          h("span", { class: "tick" }, done.has(it.id) ? "✓" : "○"), h("span", {}, (it.number && it.kind === "lesson" ? it.number + "  " : "") + it.title));
        ol.append(h("li", { class: done.has(it.id) ? "done" : "" }, btn));
      }
    };
    if (det.open) fill();
    det.append(ol);
    nav.append(det);
  }
  nav.querySelector(".current")?.scrollIntoView({ block: "center" });
  const all = lessons(), dn = all.filter((i) => done.has(i.id)).length;
  $("#bar").style.width = `${(100 * dn) / all.length}%`;
  $("#progress-text").textContent = `${dn} / ${all.length} lessons`;
  const last = store.get("aifs.last", null);
  $("#continue").hidden = !last || !byId.has(last) || (current && current.id === last);
}

// ---------- pages ----------
function go(item, anchor) {
  location.hash = `#/i/${encodeURIComponent(item.id)}${anchor ? "/" + anchor : ""}`;
  $("#outline").classList.remove("open");
}

function home() {
  renderOutline(null);
  const all = lessons(), st = catalog.stats;
  const first = order.find((i) => i.kind === "lesson");
  const last = store.get("aifs.last", null);
  const startAt = (phase) => order.find((i) => i.kind === "lesson" && i.id.startsWith(`phases/${phase}`));
  const path = (id) => order.find((i) => i.id === `learning-paths/${id}.json`);
  const backgrounds = [
    ["New to programming and AI", startAt("00"), "Phase 0, Setup", "about 306 hours"],
    ["I know Python, new to ML", startAt("01"), "Phase 1, Math Foundations", "about 270 hours"],
    ["I know ML, new to deep learning", startAt("03"), "Phase 3, Deep Learning Core", "about 200 hours"],
    ["I know deep learning, want LLMs and agents", startAt("10"), "Phase 10, LLMs from Scratch", "about 100 hours"],
    ["Senior engineer, only agent engineering", startAt("14"), "Phase 14, Agent Engineering", "about 60 hours"],
    ["Only production MCP", path("model-context-protocol"), "MCP path", "about 23 hours"],
    ["Only Agent Skills", path("agent-skills"), "Agent Skills path", "about 9.5 hours"],
    ["Only reverse engineering", path("reverse-engineering"), "Reverse Engineering path", "about 32.5 hours"],
  ].filter((r) => r[1]);

  main.replaceChildren(h("div", { class: "page" },
    h("section", { class: "hero" },
      h("h1", {}, "Learn AI engineering, one lesson at a time."),
      h("p", {}, `The whole free course in one simple order: ${st.lessons} lessons in 20 phases, then projects, manuals, certifications and revision. Read top to bottom, mark each lesson done, press Next.`),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
        last && byId.has(last) ? h("button", { class: "primary", onclick: () => go(byId.get(last)) }, `Continue: ${byId.get(last).title} →`) : null,
        h("button", { class: last ? "ghost" : "primary", onclick: () => go(order[0]) }, "Start from the very beginning →"),
        h("button", { class: "ghost", onclick: () => go(first) }, "Jump to lesson 0.1"))),
    h("div", { class: "cards" },
      card(`${st.lessons}`, "lessons", "20 phases, from setup and math to agents and production."),
      card(`${st.quizzes}`, "quizzes", "Questions before, during and after a lesson, with explanations."),
      card(`${st.figures}`, "interactive figures", "Sliders and animations from the original site, all working here."),
      card(`${order.filter((i) => i.kind === "project").length}`, "projects", "Staged builds with graders you run locally.")),
    h("h2", { class: "section" }, "Where do I start?"),
    h("table", { class: "plain" }, h("thead", {}, h("tr", {}, h("th", {}, "If you are…"), h("th", {}, "Start at"), h("th", {}, "Time"))),
      h("tbody", {}, backgrounds.map(([who, it, label, time]) => h("tr", {}, h("td", {}, who),
        h("td", {}, h("a", { href: `#/i/${encodeURIComponent(it.id)}` }, label)), h("td", { class: "muted" }, time))))),
    h("p", { class: "muted" }, "Not sure? Start at Phase 0. Lessons you already know take a few minutes to skim, and the quiz tells you if you can skip."),
    h("h2", { class: "section" }, "How to study every lesson"),
    h("ol", { class: "steps5" },
      h("li", {}, h("div", {}, h("b", {}, "Read"), " the lesson and explain the core idea in your own words.")),
      h("li", {}, h("div", {}, h("b", {}, "Type and build"), " the important code yourself, instead of only reading it.")),
      h("li", {}, h("div", {}, h("b", {}, "Run"), " the lesson's command from the course folder (each lesson shows it, with a copy button).")),
      h("li", {}, h("div", {}, h("b", {}, "Keep evidence"), ": the command, its output, and what you changed.")),
      h("li", {}, h("div", {}, h("b", {}, "Continue"), " when you can explain the output and make one small change without guessing. Then press ", h("b", {}, "Mark done & next"), "."))),
    h("h2", { class: "section" }, "The whole route, in order"),
    h("div", { class: "map" }, catalog.sections.filter((s) => s.items.length).map((s) => {
      const n = s.items.length, d = s.items.filter((i) => done.has(i.id)).length;
      const label = s.id.startsWith("phase-") ? `Phase ${+s.id.slice(6)}` : s.group;
      return h("button", { onclick: () => go(s.items[0]) }, h("span", { class: "ph" }, label), h("span", {}, s.title.replace(/^Phase \d+ · /, "")),
        h("span", { class: "n" }, `${d} / ${n}`), h("span", { class: "mini" }, h("i", { style: `width:${(100 * d) / n}%` })));
    })),
    h("h2", { class: "section" }, "Is anything missing?"),
    h("p", {}, `No. This reader was built from the course's own repository (commit ${catalog.commit}), not by copying the website. `,
      h("a", { href: "#/coverage" }, "See the coverage check"), " for how every file is accounted for."),
    h("h2", { class: "section" }, "Credits"),
    h("p", { class: "muted" }, "All course content is ", h("a", { href: "https://github.com/rohitg00/ai-engineering-from-scratch", target: "_blank", rel: "noopener" }, "AI Engineering from Scratch"),
      " by Rohit Ghumare, free and open source under the ", h("a", { href: "https://github.com/rohitg00/ai-engineering-from-scratch/blob/main/LICENSE", target: "_blank", rel: "noopener" }, "MIT licence"),
      ". The interactive figures are the course's own code. This simpler reader only rearranges it into one route. ",
      h("a", { href: "https://aiengineeringfromscratch.com", target: "_blank", rel: "noopener" }, "Visit the original site"), ".")));
  main.focus();
}

function card(big, label, text) {
  return h("div", { class: "card" }, h("div", { class: "big" }, big), h("h3", {}, label), h("p", {}, text));
}

async function coverage() {
  renderOutline(null);
  const cov = await (await fetch("/data/coverage.json")).json();
  const s = catalog.sections;
  const count = (id) => s.find((x) => x.id === id)?.items.length || 0;
  main.replaceChildren(h("div", { class: "page" },
    h("h1", { class: "item-title" }, "Coverage check"),
    h("p", {}, `Every file in the course repository (${cov.total_files} files) was checked when this reader was built.`),
    h("div", { class: "cards" },
      card(String(cov.content_shown), "files shown here", "Lessons, code, quizzes, outputs, projects, manuals, certifications, cheatsheets and more."),
      card(String(cov.website_and_tooling), "website and tooling files", "The original website's code, the build scripts and CI. They power the site, they are not lessons."),
      card(String(cov.missing.length), "missing", cov.missing.length ? cov.missing.join(", ") : "Nothing in the course is left out.")),
    h("table", { class: "plain" }, h("tbody", {}, s.filter((x) => x.items.length).map((x) => h("tr", {}, h("td", {}, x.group), h("td", {}, x.title), h("td", { class: "muted" }, `${x.items.length} items`))))),
    h("p", { class: "muted" }, `Also included: ${count("blogs")} blog posts and guides from the author's site (${catalog.public ? "linked" : "saved for offline reading"}), and ${count("site")} original website pages.`)));
}

async function text(path) {
  const r = await fetch("/repo/" + path);
  if (!r.ok) throw new Error(`Could not load ${path}`);
  return r.text();
}

async function showItem(item, anchor) {
  store.set("aifs.last", item.id);
  renderOutline(item);
  const sec = sectionOf.get(item.id);
  const idx = order.indexOf(item), inSec = sec.items.indexOf(item);
  const all = lessons(), li = all.indexOf(item);
  const meta = item.meta || {};
  const chips = [["Type", meta.type], ["Language", meta.language], ["Time", meta.time], ["Prerequisites", meta.prerequisites],
    ["Level", meta.level], ["Published", meta.date]].filter(([, v]) => v);
  const toggle = h("button", { class: `ghost done-toggle${done.has(item.id) ? " on" : ""}`, onclick: () => {
    done.has(item.id) ? done.delete(item.id) : done.add(item.id); saveDone();
    toggle.classList.toggle("on"); toggle.textContent = done.has(item.id) ? "✓ Done" : "Mark as done"; renderOutline(item);
  } }, done.has(item.id) ? "✓ Done" : "Mark as done");

  const body = h("div");
  const page = h("article", { class: "page" },
    h("div", { class: "crumbs" }, h("b", {}, sec.title), ` · item ${inSec + 1} of ${sec.items.length}`, li >= 0 ? ` · lesson ${li + 1} of ${all.length}` : ""),
    h("h1", { class: "item-title" }, item.title),
    h("div", { class: "chips" }, chips.map(([k, v]) => h("span", { class: "chip" }, `${k}: `, h("b", {}, v))), toggle),
    meta.summary ? h("p", { class: "muted" }, meta.summary) : null,
    body, pager(idx));
  main.replaceChildren(page);
  main.scrollTop = 0;
  window.scrollTo(0, 0);

  if (item.page) {
    body.append(h("p", { class: "muted" }, "This is the original website page, running from your local copy."), h("iframe", { class: "site", src: item.page, title: item.title }));
  } else if (item.url && !item.blog) {
    // Public build: blog posts stay on the author's site.
    body.append(h("p", {}, "This article is on the course author's own site."),
      h("a", { href: item.url, target: "_blank", rel: "noopener" }, h("button", { class: "primary" }, "Read the article →")));
  } else if (item.blog) {
    const original = h("p", { class: "muted" }, "By the course author. ", h("a", { href: item.url, target: "_blank", rel: "noopener" }, "Open the original article"),
      " (it has the interactive demos and the latest edits).");
    body.append(original);
    const r = await fetch(`/data/blogs/${item.blog}.html`);
    if (r.ok) {
      const blog = h("div", { class: "md blog", html: DOMPurify.sanitize(await r.text()) });
      // Interactive widgets need the original page's scripts; drop the empty shells so the text reads cleanly.
      blog.querySelectorAll("img:not([src])").forEach((n) => n.closest("[class]")?.parentElement?.remove());
      body.append(blog);
    }
  } else {
    for (const [i, doc] of item.docs.entries()) {
      if (item.docs.length > 1) body.append(h("div", { class: "doc-sep" }, doc.replace(item.id + "/", "")));
      try { body.append(renderMarkdown(await text(doc), doc, item)); }
      catch (e) { body.append(h("p", { class: "muted" }, e.message)); }
      if (i === 0 && item.steps) body.append(stepsPanel(item));
    }
    if (!item.docs.length && item.steps) body.append(stepsPanel(item));
  }
  if (item.run?.length) body.append(runPanel(item));
  if (item.quiz) body.append(await quizPanel(item.quiz));
  if (item.kind === "assessment") {
    for (const f of item.files.filter((x) => x.endsWith(".json"))) body.append(await quizPanel(f, true));
  }
  if (item.files?.length && !(item.files.length === 1 && item.docs[0] === item.files[0])) body.append(filesPanel(item));
  await hydrate(body, item);
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  main.focus({ preventScroll: true });
}

function pager(idx) {
  const prev = order[idx - 1], next = order[idx + 1];
  const item = order[idx];
  return h("nav", { class: "pager" },
    prev ? h("button", { class: "ghost", onclick: () => go(prev) }, "← Previous", h("small", {}, prev.title)) : null,
    next ? h("button", { class: "primary next", onclick: () => { done.add(item.id); saveDone(); go(next); } },
      "Mark done & next →", h("small", {}, next.title)) : h("button", { class: "primary next", onclick: () => { done.add(item.id); saveDone(); location.hash = "#/"; } }, "Finish ✓"));
}

function runPanel(item) {
  return h("section", { class: "panel" }, h("h2", {}, "Run it yourself"),
    h("p", { class: "muted" }, "Open Terminal in the course folder, then paste a command:"),
    cmdRow("cd ~/Desktop/learn/ai-engineering-from-scratch"),
    item.run.map(cmdRow));
}
function cmdRow(c) {
  return h("div", { class: "cmd" }, h("code", {}, c), h("button", { class: "ghost", onclick: () => navigator.clipboard.writeText(c).then(() => toast("Copied")) }, "Copy"));
}

function stepsPanel(item) {
  return h("section", { class: "panel" }, h("h2", {}, `This path: ${item.steps.length} lessons, in order`),
    item.meta.minutes ? h("p", { class: "muted" }, `About ${fmtMin(item.meta.minutes)} in total.`) : null,
    h("ol", { class: "steps-list" }, item.steps.map((s) => {
      const it = s.path && itemFor(s.path);
      return h("li", {}, it ? h("a", { href: `#/i/${encodeURIComponent(it.id)}` }, s.title || it.title) : (s.title || s.path),
        s.minutes ? h("span", { class: "muted" }, ` · ${fmtMin(s.minutes)}`) : null,
        s.checkpoint ? h("div", { class: "muted" }, `Checkpoint: ${s.checkpoint}`) : null);
    })));
}

const STAGES = { pre: "Before you read", check: "While you read", post: "After you read" };
// Lesson quizzes (stages pre/check/post) and certification mock exams (one or more correct answers) share this panel.
async function quizPanel(path, exam = false) {
  let data;
  try { data = JSON.parse(await text(path)); } catch { return h("div"); }
  const qs = Array.isArray(data) ? data : data.questions || [];
  const stageOf = (q) => (exam ? q.domain || "questions" : q.stage || "check");
  const stages = [...new Set(qs.map(stageOf))].sort((a, b) => Object.keys(STAGES).indexOf(a) - Object.keys(STAGES).indexOf(b));
  const title = exam ? `${data.title || path.split("/").pop()} (${qs.length} questions${data.timeLimitMinutes ? `, ${data.timeLimitMinutes} min` : ""})`
    : `Quiz (${qs.length} questions)`;
  const panel = h("section", { class: "panel" }, h("h2", {}, title));
  const tabs = h("div", { class: "quiz-tabs" }), list = h("div");
  const score = h("p", { class: "score" });
  const show = (stage) => {
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.s === stage));
    list.replaceChildren(...qs.filter((q) => stageOf(q) === stage).map(question));
  };
  stages.forEach((s) => tabs.append(h("button", { "data-s": s, onclick: () => show(s) },
    `${STAGES[s] || s.replace(/-/g, " ")} (${qs.filter((q) => stageOf(q) === s).length})`)));
  let right = 0, answered = 0;
  function question(q) {
    const correct = Array.isArray(q.correct) ? q.correct : [q.correct];
    const multi = correct.length > 1;
    const why = h("div", { class: "why" });
    const picked = new Set();
    const reveal = () => {
      const btns = [...opts.children];
      btns.forEach((b, i) => { b.disabled = true; if (correct.includes(i)) b.classList.add("right"); else if (picked.has(i)) b.classList.add("wrong"); });
      check?.remove();
      const ok = picked.size === correct.length && [...picked].every((i) => correct.includes(i));
      answered++; if (ok) right++;
      why.textContent = (ok ? "Correct. " : "Not quite. ") + (q.explanation || "");
      score.textContent = `Score: ${right} / ${answered}`;
    };
    const opts = h("div", { class: "opts" }, q.options.map((o, i) => h("button", { onclick: (e) => {
      if (!multi) { picked.add(i); return reveal(); }
      picked.has(i) ? picked.delete(i) : picked.add(i);
      e.currentTarget.classList.toggle("picked", picked.has(i));
    } }, o)));
    const check = multi ? h("button", { class: "ghost", style: "margin-top:8px", onclick: reveal }, `Check (choose ${correct.length})`) : null;
    return h("div", { class: "q" }, h("p", {}, q.question || q.prompt), opts, check, why);
  }
  panel.append(tabs, list, score);
  show(stages[0]);
  return panel;
}

const IMG = /\.(png|gif|jpe?g|webp|svg)$/i;
const LANG = { py: "python", ts: "typescript", js: "javascript", mjs: "javascript", go: "go", rs: "rust", jl: "julia", sh: "bash",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml", toml: "ini", html: "xml", css: "css", sql: "sql", c: "c", h: "c", cpp: "cpp", lua: "lua", tex: "latex" };
function filesPanel(item) {
  const files = item.files.filter((f) => !item.docs.includes(f) && f !== item.quiz);
  if (!files.length) return h("div");
  return h("section", { class: "panel files" }, h("h2", {}, `Every file in this ${item.kind === "lesson" ? "lesson" : "item"} (${files.length})`),
    h("p", { class: "muted" }, "The lesson text above is the main read. Open any file below to see it in full."),
    h("ul", {}, files.map((f) => {
      const det = h("details", {}, h("summary", {}, f.replace(item.id + "/", ""), h("span", {}, f.split(".").pop().toUpperCase())));
      const view = h("div", { class: "view" });
      det.append(view);
      det.addEventListener("toggle", async () => {
        if (!det.open || view.childElementCount) return;
        const ext = f.split(".").pop().toLowerCase();
        if (IMG.test(f)) { view.append(h("img", { src: "/repo/" + f, alt: f, style: "max-width:100%" })); return; }
        if (["o", "bin", "pdf", "zip", "wasm"].includes(ext)) { view.append(h("p", { class: "muted" }, "Binary file (compiled or archive), not readable as text. ", h("a", { href: "/repo/" + f, target: "_blank" }, "Download"))); return; }
        const t = await text(f);
        if (ext === "md") { const md = renderMarkdown(t, f, item); view.append(md); await hydrate(md, item); return; }
        const code = h("code", { class: LANG[ext] ? `language-${LANG[ext]}` : "" });
        code.textContent = ext === "json" ? (() => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; } })() : t;
        view.append(h("div", { class: "md" }, h("pre", {}, code)));
        if (t.length < 400000) hljs.highlightElement(code);
      });
      return h("li", {}, det);
    })));
}

// ---------- search ----------
function setupSearch() {
  const input = $("#search"), results = $("#results");
  let hits = [], sel = 0;
  const paint = () => {
    results.replaceChildren(...hits.map((it, i) => h("button", { class: i === sel ? "on" : "", onmousedown: (e) => { e.preventDefault(); pick(it); } },
      it.title, h("small", {}, sectionOf.get(it.id).title))));
    results.hidden = !hits.length;
  };
  const pick = (it) => { input.value = ""; hits = []; paint(); input.blur(); go(it); };
  input.addEventListener("input", () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    hits = words.length ? order.filter((it) => { const t = `${it.title} ${sectionOf.get(it.id).title} ${it.id}`.toLowerCase(); return words.every((w) => t.includes(w)); }).slice(0, 40) : [];
    sel = 0; paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); paint(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
    if (e.key === "Enter" && hits[sel]) pick(hits[sel]);
    if (e.key === "Escape") { hits = []; paint(); }
  });
  input.addEventListener("blur", () => setTimeout(() => (results.hidden = true), 100));
  document.addEventListener("keydown", (e) => { if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); } });
}

// ---------- routing ----------
function route() {
  const m = location.hash.match(/^#\/i\/([^/]+)(?:\/(.+))?$/);
  if (m && byId.has(decodeURIComponent(m[1]))) return showItem(byId.get(decodeURIComponent(m[1])), m[2]);
  if (location.hash === "#/coverage") return coverage();
  return home();
}

(async function start() {
  catalog = await (await fetch("/data/catalog.json")).json();
  for (const s of catalog.sections) for (const it of s.items) { order.push(it); byId.set(it.id, it); sectionOf.set(it.id, s); }
  $("#menu").addEventListener("click", () => $("#outline").classList.toggle("open"));
  $("#continue").addEventListener("click", () => { const l = store.get("aifs.last", null); if (byId.has(l)) go(byId.get(l)); });
  setupSearch();
  addEventListener("hashchange", route);
  route();
})();
