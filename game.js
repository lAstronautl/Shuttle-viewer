const $ = id => document.getElementById(id);

const ROUNDS = 5;
const MAX_W = 820, MAX_H = 560;       // canvas size limit, in css pixels
const PX_MAX = 700, TIME_MAX = 300;   // points for few opened pixels / for speed
const TIME_FULL = 90;                 // seconds after which the speed bonus is gone
const WRONG = 75;                     // penalty for a wrong answer
const HARD_MULT = 1.5;

const prefs = { kind: "ship", diff: "easy", custom: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("gamePrefs") || "{}")); } catch (e) { /* ignore */ }

let data = null;
let g = null; // current game
let r = null; // current round

const norm = s => String(s).toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// accepted spellings of a name: full, without "(...)", without the first word ("NT Vagabond" -> "Vagabond")
function aliases(name) {
  const set = new Set([norm(name)]);
  const plain = norm(name.replace(/\([^)]*\)/g, " "));
  if (plain) set.add(plain);
  const words = plain.split(" ");
  if (words.length > 1) set.add(words.slice(1).join(" "));
  return set;
}

function isCorrect(guess, target, pool) {
  const q = norm(guess);
  if (!q) return false;
  if (norm(target.name) === q) return true;
  if (pool.some(p => norm(p.name) === q)) return false; // it is the exact name of another item
  return aliases(target.name).has(q);
}

function pool() {
  const hard = prefs.diff === "hard";
  const list = prefs.kind === "poi" ? data.pois : data.shuttles;
  return list.filter(s => (hard ? s.minimap : s.image) && (prefs.kind === "poi" || prefs.custom || s.group !== "Custom"));
}

function bestKey() { return `gameBest:${prefs.kind}:${prefs.diff}`; }
function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

/* ---------- setup ---------- */

function refreshSetup() {
  document.querySelectorAll("#s-kind button").forEach(b => b.classList.toggle("on", b.dataset.kind === prefs.kind));
  document.querySelectorAll("#s-diff button").forEach(b => b.classList.toggle("on", b.dataset.diff === prefs.diff));
  $("s-custom").checked = prefs.custom;
  $("s-custom-row").hidden = prefs.kind === "poi";
  const n = pool().length;
  $("s-info").textContent = n
    ? `Доступно картинок в этом режиме: ${n}.`
    : "Для этого режима пока нет картинок (рендеры ещё не собраны).";
  const best = getBest();
  $("s-best").textContent = best ? `Ваш рекорд в этом режиме: ${best}.` : "";
  $("start").disabled = n === 0;
}

function savePrefs() {
  try { localStorage.setItem("gamePrefs", JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  refreshSetup();
}

document.querySelectorAll("#s-kind button").forEach(b => b.onclick = () => { prefs.kind = b.dataset.kind; savePrefs(); });
document.querySelectorAll("#s-diff button").forEach(b => b.onclick = () => { prefs.diff = b.dataset.diff; savePrefs(); });
$("s-custom").onchange = e => { prefs.custom = e.target.checked; savePrefs(); };

/* ---------- game ---------- */

function show(id) {
  for (const s of ["setup", "play", "final"]) $(s).hidden = s !== id;
}

function startGame() {
  const items = pool();
  const picked = [...items].sort(() => Math.random() - 0.5).slice(0, ROUNDS);
  g = { items: picked, pool: items, i: 0, total: 0, log: [] };
  const names = [...new Set(items.map(s => s.name))].sort((a, b) => a.localeCompare(b));
  $("g-names").replaceChildren(...names.map(n => Object.assign(document.createElement("option"), { value: n })));
  show("play");
  startRound();
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("не удалось загрузить " + src));
    im.src = src;
  });
}

async function startRound() {
  const item = g.items[g.i];
  const hard = prefs.diff === "hard";
  $("result").hidden = true;
  $("g-msg").className = "note";
  $("g-msg").textContent = "Загрузка...";
  setControls(false);
  let img;
  try {
    img = await loadImage(hard ? item.minimap : item.image);
  } catch (e) {
    $("g-msg").textContent = "Ошибка: " + e.message;
    return;
  }

  const cellSrc = hard ? 1 : 32; // one "pixel" = one map tile
  const cols = Math.ceil(img.naturalWidth / cellSrc), rows = Math.ceil(img.naturalHeight / cellSrc);
  const cell = Math.max(3, Math.min(40, Math.floor(Math.min(MAX_W / cols, MAX_H / rows))));

  // cells with at least one visible pixel; fully transparent ones carry no information
  const probe = document.createElement("canvas");
  probe.width = img.naturalWidth; probe.height = img.naturalHeight;
  const pc = probe.getContext("2d", { willReadFrequently: true });
  pc.drawImage(img, 0, 0);
  const px = pc.getImageData(0, 0, probe.width, probe.height).data;
  const filled = new Uint8Array(cols * rows);
  let filledCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x1 = Math.min(img.naturalWidth, (cx + 1) * cellSrc), y1 = Math.min(img.naturalHeight, (cy + 1) * cellSrc);
      let on = false;
      for (let y = cy * cellSrc; y < y1 && !on; y++) {
        for (let x = cx * cellSrc; x < x1; x++) {
          if (px[(y * probe.width + x) * 4 + 3] > 10) { on = true; break; }
        }
      }
      if (on) { filled[cy * cols + cx] = 1; filledCount++; }
    }
  }

  const cv = $("cv");
  cv.width = cols * cell; cv.height = rows * cell;
  cv.className = "";
  r = {
    item, img, hard, cellSrc, cols, rows, cell, filled, filledCount: Math.max(1, filledCount),
    open: new Uint8Array(cols * rows), used: 0, wrong: 0, done: false, hover: -1,
    start: performance.now(), end: 0,
  };
  $("g-input").value = "";
  $("g-msg").textContent = "";
  setControls(true);
  $("h-round").textContent = `${g.i + 1}/${g.items.length}`;
  draw();
  hud();
  clearInterval(startRound.timer);
  startRound.timer = setInterval(hud, 250);
  $("g-input").focus();
}

function setControls(on) {
  for (const id of ["g-input", "g-random", "g-giveup"]) $(id).disabled = !on;
  $("guess").querySelector("button[type=submit]").disabled = !on;
}

function elapsed() { return ((r.done ? r.end : performance.now()) - r.start) / 1000; }

function calc() {
  const f = Math.min(1, r.used / r.filledCount);
  const pxPts = PX_MAX * Math.pow(1 - f, 3);
  const timePts = TIME_MAX * Math.max(0, 1 - elapsed() / TIME_FULL);
  const penalty = r.wrong * WRONG;
  const mult = r.hard ? HARD_MULT : 1;
  return { pxPts, timePts, penalty, mult, total: Math.round(Math.max(0, pxPts + timePts - penalty) * mult) };
}

function hud() {
  if (!r) return;
  $("h-px").textContent = r.used;
  $("h-time").textContent = Math.floor(elapsed());
  $("h-score").textContent = g.total;
  $("h-now").textContent = r.done ? 0 : calc().total;
}

/* ---------- drawing ---------- */

function draw() {
  const cv = $("cv"), ctx = cv.getContext("2d");
  const { cols, rows, cell, cellSrc, img, hard } = r;
  ctx.imageSmoothingEnabled = !hard;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, cv.width, cv.height);

  if (r.done) {
    ctx.fillStyle = "#0e0e0e";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, img.naturalWidth / cellSrc * cell, img.naturalHeight / cellSrc * cell);
    return;
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!r.open[cy * cols + cx]) continue;
      const sx = cx * cellSrc, sy = cy * cellSrc;
      const sw = Math.min(cellSrc, img.naturalWidth - sx), sh = Math.min(cellSrc, img.naturalHeight - sy);
      ctx.fillStyle = "#0e0e0e";
      ctx.fillRect(cx * cell, cy * cell, cell, cell);
      ctx.drawImage(img, sx, sy, sw, sh, cx * cell, cy * cell, sw / cellSrc * cell, sh / cellSrc * cell);
    }
  }

  if (cell >= 5) {
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, rows * cell); }
    for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(cols * cell, y * cell + 0.5); }
    ctx.stroke();
  }

  if (r.hover >= 0 && !r.open[r.hover]) {
    const hx = r.hover % cols, hy = Math.floor(r.hover / cols);
    ctx.strokeStyle = "#d8d8d8";
    ctx.lineWidth = 2;
    ctx.strokeRect(hx * cell + 1, hy * cell + 1, cell - 2, cell - 2);
  }
}

function cellAt(e) {
  const cv = $("cv"), box = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - box.left) * cv.width / box.width / r.cell);
  const y = Math.floor((e.clientY - box.top) * cv.height / box.height / r.cell);
  return x >= 0 && y >= 0 && x < r.cols && y < r.rows ? y * r.cols + x : -1;
}

function reveal(idx) {
  if (!r || r.done || idx < 0 || r.open[idx]) return;
  r.open[idx] = 1;
  r.used++;
  draw();
  hud();
}

$("cv").addEventListener("mousemove", e => {
  if (!r || r.done) return;
  const idx = cellAt(e);
  if (idx !== r.hover) { r.hover = idx; draw(); }
});
$("cv").addEventListener("mouseleave", () => { if (r && !r.done && r.hover !== -1) { r.hover = -1; draw(); } });
$("cv").addEventListener("click", e => reveal(cellAt(e)));

$("g-random").onclick = () => {
  const left = [];
  for (let i = 0; i < r.filled.length; i++) if (r.filled[i] && !r.open[i]) left.push(i);
  if (left.length) reveal(left[Math.floor(Math.random() * left.length)]);
  $("g-input").focus();
};

/* ---------- guessing ---------- */

$("guess").addEventListener("submit", e => {
  e.preventDefault();
  if (!r || r.done) return;
  const text = $("g-input").value.trim();
  if (!text) return;
  if (isCorrect(text, r.item, g.pool)) {
    endRound(true);
  } else {
    r.wrong++;
    const msg = $("g-msg");
    msg.className = "note bad";
    msg.textContent = `Не то: "${text}". Минус ${WRONG} очков.`;
    $("g-input").select();
    hud();
  }
});

$("g-giveup").onclick = () => { if (r && !r.done) endRound(false); };

function endRound(won) {
  r.done = true;
  r.end = performance.now();
  clearInterval(startRound.timer);
  const c = calc();
  const pts = won ? c.total : 0;
  g.total += pts;
  g.log.push({ name: r.item.name, pts });
  $("cv").className = "done";
  draw();
  hud();
  setControls(false);

  const mark = r.item.kind || (prefs.kind === "poi" ? "poi" : "ship");
  $("r-title").textContent = (won ? "Верно: " : "Это был(а): ") + r.item.name;
  $("r-detail").textContent = won
    ? `Открыто пикселей: ${r.used} из ${r.filledCount} (${Math.round(c.pxPts)} оч.), время ${Math.round(elapsed())} с (${Math.round(c.timePts)} оч.), `
      + `ошибок: ${r.wrong} (минус ${c.penalty})${r.hard ? ", сложность x" + HARD_MULT : ""}. Итого за раунд: ${pts}.`
    : "Раунд пропущен, очки не начислены.";
  $("g-msg").className = "note " + (won ? "good" : "bad");
  $("g-msg").textContent = won ? `+${pts} очков` : "Сдались";
  $("r-view").href = `viewer/?map=${mark}-${encodeURIComponent(r.item.id)}&view=${r.hard ? "mini" : "render"}`;
  $("r-next").textContent = g.i + 1 < g.items.length ? "Дальше" : "Итоги";
  $("result").hidden = false;
  $("r-next").focus();
}

$("r-next").onclick = () => {
  if (g.i + 1 < g.items.length) {
    g.i++;
    startRound();
  } else {
    finish();
  }
};

function finish() {
  const prev = getBest();
  const record = g.total > prev;
  if (record) { try { localStorage.setItem(bestKey(), String(g.total)); } catch (e) { /* ignore */ } }
  $("f-score").textContent = g.total;
  $("f-best").textContent = record ? "Новый рекорд!" : (prev ? `Рекорд в этом режиме: ${prev}.` : "");
  $("f-list").replaceChildren(...g.log.map(x => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { textContent: x.name }),
              Object.assign(document.createElement("span"), { textContent: x.pts }));
    return li;
  }));
  show("final");
  r = null;
}

$("start").onclick = startGame;
$("again").onclick = () => { show("setup"); refreshSetup(); };

fetch("shuttles.json").then(res => res.json()).then(d => {
  data = d;
  data.shuttles.forEach(s => { s.kind = "ship"; });
  data.pois = d.pois || [];
  data.pois.forEach(s => { s.kind = "poi"; });
  refreshSetup();
}).catch(() => { $("s-info").textContent = "Не удалось загрузить shuttles.json"; });
