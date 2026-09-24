const contentEl = document.getElementById("content");
const viewportEl = document.getElementById("viewport");
const colophon = document.getElementById("colophon");
const aboutBtn = document.getElementById("aboutBtn");
const closeBtn = document.getElementById("closeColophon");
const pill = document.getElementById("closeCursor");

const SPEED = 40;     // px per second
const FONT_PX = 16;
const ROW_PX = 24;
const ROWS = 30;      // rows per chunk
const BUFFER = 1.5;   // screens rendered above and below the view

let banned = new Set();
let str = "";         // the whole text as one line
let chunks = [];
let active = new Set();
let colChars = 80;    // characters per row (monospace)
let nRows = 0;
let padTop = 0, padBottom = 0;
let pos = 0;
let running = false, loaded = false;
let lastFrame = 0, lastUpdate = 0, rafId = null;

const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const esc = (t) => t.replace(/[&<>]/g, (c) => ENT[c]);
const isW = (ch) => ch !== undefined && /\w/.test(ch);

async function fetchText(url, ms = 20000) {
  const res = await Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms)),
  ]);
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.text();
}

function hueFor(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return Math.floor((x - Math.floor(x)) * 360);
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
  nRows = Math.ceil(str.length / colChars);
}

function buildChunks() {
  const frag = document.createDocumentFragment();
  const n = Math.ceil(nRows / ROWS);
  chunks = [];
  active.clear();
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    el.style.height = Math.min(ROWS, nRows - i * ROWS) * ROW_PX + "px";
    frag.appendChild(el);
    chunks.push(el);
  }
  contentEl.replaceChildren(frag);
}

// Every row holds exactly colChars characters. Banned words are found on the
// whole word (even if a row break falls inside it) and blurred on both rows.
function render(ci) {
  const a = ci * ROWS * colChars;
  const b = Math.min(str.length, a + ROWS * colChars);
  let ea = a, eb = b;
  while (ea > 0 && isW(str[ea - 1])) ea--;
  while (eb < str.length && isW(str[eb])) eb++;

  const ranges = [];
  const slice = str.slice(ea, eb);
  const re = /\w+/g;
  let m;
  while ((m = re.exec(slice))) {
    const clean = m[0].replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (clean && banned.has(clean)) ranges.push([ea + m.index, ea + m.index + m[0].length]);
  }

  let html = "";
  let j = 0;
  for (let rs = a; rs < b; rs += colChars) {
    const rend = Math.min(b, rs + colChars);
    while (j < ranges.length && ranges[j][1] <= rs) j++;
    let p = rs, k = j, row = "";
    while (k < ranges.length && ranges[k][0] < rend) {
      const [s, e] = ranges[k];
      const s2 = Math.max(s, rs), e2 = Math.min(e, rend);
      row += esc(str.slice(p, s2)) +
        '<span class="blur" style="--h:' + hueFor(s) + '">' + esc(str.slice(s2, e2)) + "</span>";
      p = e2;
      if (e <= rend) k++; else break;
    }
    row += esc(str.slice(p, rend));
    html += '<div class="row">' + row + "</div>";
    j = k;
  }
  return html;
}

function update() {
  const vh = viewportEl.clientHeight;
  const chunkH = ROWS * ROW_PX;
  const lo = Math.max(0, Math.floor((pos - vh * BUFFER - padTop) / chunkH));
  const hi = Math.min(chunks.length - 1, Math.floor((pos + vh * (1 + BUFFER) - padTop) / chunkH));
  for (const i of [...active]) {
    if (i < lo || i > hi) { chunks[i].textContent = ""; active.delete(i); }
  }
  for (let i = lo; i <= hi; i++) {
    if (!active.has(i)) { chunks[i].innerHTML = render(i); active.add(i); }
  }
}

function layout() {
  const keep = loaded ? (Math.max(0, pos - padTop) / ROW_PX) * colChars : null; // characters scrolled past
  measure();
  buildChunks();
  pos = keep === null ? 0 : padTop + (keep / colChars) * ROW_PX;
  update();
}

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  pos += SPEED * dt;
  if (pos >= padTop + nRows * ROW_PX + padBottom - viewportEl.clientHeight) pos = 0;
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
    str = text.replace(/\s+/g, " ").trim();

    try { await document.fonts.load(FONT_PX + "px Inconsolata"); } catch (e) {}

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

// ---- Gradient blob cursor ----
// A chain of soft dots: the head chases the mouse and each dot chases the one ahead.
// Moving spreads them into a tail; standing still lets them settle back into one blob.
const blob = document.getElementById("blob");
const bctx = blob.getContext("2d");
const fineCursor = matchMedia("(hover: hover) and (pointer: fine)").matches;
const TAIL = 8;
const FOLLOW = .8;
let trail = [];
let mx = 0, my = 0, blobRaf = null;

function sizeBlob() {
  const d = window.devicePixelRatio || 1;
  blob.width = innerWidth * d;
  blob.height = innerHeight * d;
  bctx.setTransform(d, 0, 0, d, 0, 0);
}

function drawBlob() {
  bctx.clearRect(0, 0, innerWidth, innerHeight);
  let moving = false;
  let lead = { x: mx, y: my };
  for (const p of trail) {
    const dx = lead.x - p.x, dy = lead.y - p.y;
    p.x += dx * FOLLOW;
    p.y += dy * FOLLOW;
    if (Math.abs(dx) + Math.abs(dy) > 0.3) moving = true;
    lead = p;
  }
  for (let i = TAIL - 1; i >= 0; i--) {
    const p = trail[i];
    const r = 20 * (1 - 0.75 * (i / TAIL));
    const h = (p.x * 0.12 + p.y * 0.12 + i * 5) % 360; // hue follows screen position, like the words
    const g = bctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, "hsla(" + h + ",95%,55%,.45)");
    g.addColorStop(1, "hsla(" + (h + 70) + ",95%,55%,0)");
    bctx.fillStyle = g;
    bctx.beginPath();
    bctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    bctx.fill();
  }
  return moving;
}

function blobFrame() {
  blobRaf = drawBlob() ? requestAnimationFrame(blobFrame) : null;
}

if (fineCursor) {
  sizeBlob();
  window.addEventListener("resize", sizeBlob);
  document.addEventListener("mousemove", (e) => {
    mx = e.clientX;
    my = e.clientY;
    document.body.classList.remove("cursor-out");
    if (!trail.length) trail = Array.from({ length: TAIL }, () => ({ x: mx, y: my }));
    if (!blobRaf) blobRaf = requestAnimationFrame(blobFrame);
  });
  document.documentElement.addEventListener("mouseleave", () => {
    document.body.classList.add("cursor-out");
  });
}

init();