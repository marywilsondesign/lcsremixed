const contentEl = document.getElementById("content");
const viewportEl = document.getElementById("viewport");
const colophon = document.getElementById("colophon");
const aboutBtn = document.getElementById("aboutBtn");
const closeBtn = document.getElementById("closeColophon");
const pill = document.getElementById("closeCursor");

const SPEED = 40;         // px per second
const CHUNK_LINES = 20;   // source lines per chunk
const BUFFER = 1.5;       // screens of text kept rendered above and below the view
const FONT_PX = 16;
const LINE_PX = 24;

let banned = new Set();
let chunks = [];          // { el, lines, chars, h, on }
let tops = [];            // top offset of each chunk, plus the end of the last
let colChars = 80;        // monospace characters per row
let padTop = 0, padBottom = 0;
let pos = 0;              // our own float scroll position
let running = false, loaded = false;
let lastFrame = 0, lastUpdate = 0, rafId = null;

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

async function fetchText(url, ms = 20000) {
  const res = await Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms)),
  ]);
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.text();
}

// Deterministic hue per word, so a word always looks the same.
function hueFor(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return Math.floor((x - Math.floor(x)) * 360);
}

// Only the chunks near the view are ever turned into HTML.
function render(ci) {
  const c = chunks[ci];
  let n = 0;
  return c.lines
    .join("\n")
    .replace(/(\w+)|[&<>]/g, (m, w) => {
      if (!w) return ENT[m];
      const clean = w.replace(/[^a-zA-Z]/g, "").toLowerCase();
      if (clean && banned.has(clean)) {
        return '<span class="blur" style="--h:' + hueFor(ci * 1000 + n++) + '">' + w + "</span>";
      }
      return w;
    });
}

function measure() {
  const cs = getComputedStyle(contentEl);
  padTop = parseFloat(cs.paddingTop);
  padBottom = parseFloat(cs.paddingBottom);
  const usable = viewportEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-size:" + FONT_PX + "px";
  probe.textContent = "x".repeat(100);
  contentEl.appendChild(probe);
  const charW = probe.getBoundingClientRect().width / 100 || FONT_PX * 0.5;
  probe.remove();
  colChars = Math.max(20, Math.floor(usable / charW));
}

function estimate(c) {
  // Monospace type makes row counts predictable; 4% covers word-wrap slack.
  return Math.ceil((c.chars * 1.04) / colChars + c.lines.length * 0.5) * LINE_PX;
}

function retop(from = 0) {
  tops[0] = padTop;
  for (let i = from; i < chunks.length; i++) tops[i + 1] = tops[i] + chunks[i].h;
}

function populate(i) {
  const c = chunks[i];
  if (c.on) return;
  c.el.style.height = "auto";
  c.el.innerHTML = render(i);
  c.on = true;
  const h = c.el.offsetHeight;
  if (h !== c.h) {
    if (tops[i] + c.h <= pos) pos += h - c.h; // chunk above the view: keep the view still
    c.h = h;
    retop(i);
  }
}

function unpopulate(i) {
  const c = chunks[i];
  if (!c.on) return;
  c.h = c.el.offsetHeight;
  c.el.textContent = "";
  c.el.style.height = c.h + "px";
  c.on = false;
}

function update() {
  const vh = viewportEl.clientHeight;
  const lo = pos - vh * BUFFER;
  const hi = pos + vh * (1 + BUFFER);
  for (let i = 0; i < chunks.length; i++) {
    const top = tops[i];
    if (top + chunks[i].h > lo && top < hi) populate(i);
    else unpopulate(i);
  }
}

function layout() {
  measure();
  chunks.forEach((c) => {
    c.on = false;
    c.el.textContent = "";
    c.h = estimate(c);
    c.el.style.height = c.h + "px";
  });
  retop();
  update();
}

function totalHeight() {
  return tops[chunks.length] + padBottom;
}

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  pos += SPEED * dt;
  if (pos >= totalHeight() - viewportEl.clientHeight) pos = 0;
  if (now - lastUpdate > 250) { update(); lastUpdate = now; }
  viewportEl.scrollTop = pos;
  rafId = requestAnimationFrame(tick);
}

function start() {
  if (running) return;
  running = true;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(tick);
}

async function init() {
  try {
    const [text, bannedRaw] = await Promise.all([
      fetchText("./full.txt"),
      fetchText("./bannedWords.txt"),
    ]);
    banned = new Set(bannedRaw.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
      const part = lines.slice(i, i + CHUNK_LINES);
      const el = document.createElement("div");
      el.className = "chunk";
      frag.appendChild(el);
      chunks.push({ el, lines: part, chars: part.reduce((n, l) => n + l.length + 1, 0), h: 0, on: false });
    }

    try { await document.fonts.load(FONT_PX + "px Inconsolata"); } catch (e) {}

    contentEl.replaceChildren(frag);
    layout();
    loaded = true;
    start();
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = "<p>Unable to load the text. Run the site from a local server and check that full.txt and bannedWords.txt sit next to index.html.</p>";
  }
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (loaded) layout(); }, 200);
});

// ---- Colophon and pill cursor ----
function openColophon() {
  colophon.classList.add("open");
}

function closeColophon() {
  colophon.classList.remove("open");
  document.body.classList.remove("cursor-close");
}

aboutBtn.onclick = openColophon;
closeBtn.onclick = closeColophon;

document.addEventListener("click", (e) => {
  if (!colophon.contains(e.target) && !aboutBtn.contains(e.target)) closeColophon();
});

document.addEventListener("mousemove", (e) => {
  pill.style.transform = "translate(" + e.clientX + "px, " + e.clientY + "px) translate(-50%, -50%)";
  const outside =
    colophon.classList.contains("open") &&
    !colophon.contains(e.target) &&
    !closeBtn.contains(e.target);
  document.body.classList.toggle("cursor-close", outside);
});

document.documentElement.addEventListener("mouseleave", () => {
  document.body.classList.remove("cursor-close");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    running = false;
  } else if (loaded) {
    start();
  }
});

viewportEl.addEventListener("touchstart", (e) => e.preventDefault());
viewportEl.addEventListener("touchmove", (e) => e.preventDefault());

init();