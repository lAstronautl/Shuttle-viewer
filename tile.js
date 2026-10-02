const $ = id => document.getElementById(id);

const TILE = 32;                      // one map tile in the render, px
const MAX_W = 760, MAX_H = 600;       // map canvas limit, css px
const START = 1000, TIME_MAX = 300, TIME_FULL = 90;
const WRONG = 100, HINT = 150, HARD_MULT = 1.5;
const TEMP_COLOR = { 3: "#d98a8a", 2: "#d9a066", 1: "#7fb2e5", 0: "#6f7f95" };
const TEMP_LABEL = { 3: "Горячо", 2: "Тепло", 1: "Прохладно", 0: "Холодно" };
const HIDDEN = "#262626"; // unopened tiles: a solid silhouette, the picture is fully hidden on any difficulty

const prefs = { kind: "ship", diff: "easy", custom: false, rounds: 5, lives: 1 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("tilePrefs") || "{}")); } catch (e) { /* ignore */ }

let data = null;
let g = null; // game
let r = null; // round

const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function pool() {
  const list = prefs.kind === "poi" ? data.pois : prefs.kind === "all" ? [...data.shuttles, ...data.pois] : data.shuttles;
  return list.filter(s => s.image && (s.kind === "poi" || prefs.custom || s.group !== "Custom"));
}

function bestKey() { return `tileBest:${prefs.kind}:${prefs.diff}`; }
function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

/* ---------- setup ---------- */

function refreshSetup() {
  document.querySelectorAll("#s-kind button").forEach(b => b.classList.toggle("on", b.dataset.kind === prefs.kind));
  document.querySelectorAll("#s-diff button").forEach(b => b.classList.toggle("on", b.dataset.diff === prefs.diff));
  $("s-custom").checked = prefs.custom;
  $("s-custom-row").hidden = prefs.kind === "poi";
  prefs.rounds = Math.max(1, Math.min(30, Math.floor(prefs.rounds) || 5));
  prefs.lives = Math.max(1, Math.min(10, Math.floor(prefs.lives) || 1));
  $("s-rounds").value = prefs.rounds;
  $("s-lives").value = prefs.lives;
  const n = pool().length;
  $("s-info").textContent = !n ? "Для этого режима пока нет рендеров (они собираются в Actions)."
    : prefs.rounds > n ? `Раундов будет ${n}: больше карт нет.` : "";
  const best = getBest();
  $("s-best").textContent = best ? `Ваш рекорд в этом режиме: ${best}.` : "";
  $("start").disabled = n === 0;
}

function savePrefs() {
  try { localStorage.setItem("tilePrefs", JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  refreshSetup();
}

document.querySelectorAll("#s-kind button").forEach(b => b.onclick = () => { prefs.kind = b.dataset.kind; savePrefs(); });
document.querySelectorAll("#s-diff button").forEach(b => b.onclick = () => { prefs.diff = b.dataset.diff; savePrefs(); });
$("s-rounds").onchange = e => { prefs.rounds = +e.target.value; savePrefs(); };
$("s-lives").onchange = e => { prefs.lives = +e.target.value; savePrefs(); };
$("s-custom").onchange = e => { prefs.custom = e.target.checked; savePrefs(); };

/* ---------- map analysis ---------- */

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("не удалось загрузить " + src));
    im.src = src;
  });
}

// per tile: is it empty, a content key (two 32-bit hashes) and the number of distinct colours
function analyse(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
  const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
  const empty = new Uint8Array(cols * rows), keys = new Array(cols * rows), colors = new Uint16Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let h1 = 2166136261, h2 = 5381, visible = false;
      const seen = new Set();
      const x1 = Math.min(w, (cx + 1) * TILE), y1 = Math.min(h, (cy + 1) * TILE);
      for (let y = cy * TILE; y < y1; y++) {
        for (let x = cx * TILE; x < x1; x++) {
          const v = px[y * w + x];
          if ((v >>> 24) > 10) visible = true;
          h1 = Math.imul(h1 ^ v, 16777619);
          h2 = (Math.imul(h2, 33) + v) | 0;
          if (seen.size < 64) seen.add(v);
        }
      }
      const i = cy * cols + cx;
      empty[i] = visible ? 0 : 1;
      keys[i] = (h1 >>> 0) + ":" + (h2 >>> 0);
      colors[i] = seen.size;
    }
  }
  return { cols, rows, empty, keys, colors };
}

// a striking tile that is unique on the map; weaker candidates only if there are none
function pickTarget(a) {
  const count = new Map();
  a.keys.forEach((k, i) => { if (!a.empty[i]) count.set(k, (count.get(k) || 0) + 1); });
  const tiers = [
    i => count.get(a.keys[i]) === 1 && a.colors[i] >= 12,
    i => count.get(a.keys[i]) === 1 && a.colors[i] >= 5,
    i => a.colors[i] >= 5,
    () => true,
  ];
  for (const ok of tiers) {
    const list = [];
    for (let i = 0; i < a.empty.length; i++) if (!a.empty[i] && ok(i)) list.push(i);
    if (list.length) return list[Math.floor(Math.random() * list.length)];
  }
  return -1;
}

// window 3x3: the target tile in the centre, neighbours only when revealed by hints
// hard mode: how close a clicked tile is to the target (3 hot .. 0 cold), scaled by the map size
function temperature(i) {
  const { cols, rows } = r.a;
  const d = Math.hypot((i % cols) - (r.target % cols), Math.floor(i / cols) - Math.floor(r.target / cols));
  const s = Math.max(cols, rows);
  if (d <= 1.5) return 3;
  if (d <= Math.max(3.2, 0.2 * s)) return 2;
  if (d <= Math.max(6.5, 0.4 * s)) return 1;
  return 0;
}

function drawWindow() {
  const cv = $("target"), ctx = cv.getContext("2d"), t = cv.width / 3;
  const { a, img } = r, tx = r.target % a.cols, ty = Math.floor(r.target / a.cols);
  ctx.imageSmoothingEnabled = false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy, px = (dx + 1) * t, py = (dy + 1) * t;
      const inMap = x >= 0 && y >= 0 && x < a.cols && y < a.rows;
      const idx = y * a.cols + x;
      // the centre is hidden on hard until the round ends; neighbours show up when hinted or already opened by a click
      const shown = (!dx && !dy) ? (!r.hard || r.done) : inMap && (r.hinted.includes(idx) || r.opened[idx] === 1);
      ctx.fillStyle = shown ? "#0e0e0e" : "#1a1a1a";
      ctx.fillRect(px, py, t, t);
      if (shown && x >= 0 && y >= 0 && x < a.cols && y < a.rows) {
        const sx = x * TILE, sy = y * TILE, w = Math.min(TILE, img.naturalWidth - sx), h = Math.min(TILE, img.naturalHeight - sy);
        ctx.drawImage(img, sx, sy, w, h, px, py, t * w / TILE, t * h / TILE);
      } else if (!shown) {
        ctx.fillStyle = "#303030";
        ctx.font = `${Math.round(t / 2)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("?", px + t / 2, py + t / 2);
      }
    }
  }
  ctx.strokeStyle = "#383838"; ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    ctx.beginPath(); ctx.moveTo(k * t + 0.5, 0); ctx.lineTo(k * t + 0.5, cv.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k * t + 0.5); ctx.lineTo(cv.width, k * t + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = "#d8d8d8"; ctx.lineWidth = 2;
  ctx.strokeRect(t + 1, t + 1, t - 2, t - 2);
}

/* ---------- game ---------- */

function show(id) { for (const s of ["setup", "play", "final"]) $(s).hidden = s !== id; }

function startGame() {
  const items = pool();
  g = { items: [...items].sort(() => Math.random() - 0.5).slice(0, prefs.rounds), i: 0, total: 0, log: [], lives: prefs.lives };
  show("play");
  startRound();
}

function setControls(on) { $("t-hint").disabled = !on; $("t-giveup").disabled = !on; }

async function startRound() {
  const item = g.items[g.i];
  $("result").hidden = true;
  $("g-msg").className = "note";
  $("g-msg").textContent = "Загрузка...";
  setControls(false);
  let img;
  try { img = await loadImage(item.image); } catch (e) { $("g-msg").textContent = "Ошибка: " + e.message; return; }

  const a = analyse(img);
  const target = pickTarget(a);
  if (target < 0) { $("g-msg").textContent = "Не нашлось тайлов на этой карте."; return; }

  const scale = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1.5);
  const cv = $("cv");
  cv.width = Math.round(img.naturalWidth * scale);
  cv.height = Math.round(img.naturalHeight * scale);
  r = {
    item, img, a, target, scale, cs: TILE * scale, opened: new Uint8Array(a.cols * a.rows),
    wrong: 0, hints: 0, hinted: [], done: false, hover: -1, start: performance.now(), end: 0,
    hard: prefs.diff === "hard", temp: {},
  };
  $("t-hint").hidden = r.hard;
  $("t-cold").hidden = !r.hard;
  drawWindow();
  $("t-name").textContent = item.name;
  $("g-msg").textContent = "";
  $("h-round").textContent = `${g.i + 1}/${g.items.length}`;
  cv.className = "";
  setControls(true);
  draw();
  hud();
  clearInterval(startRound.timer);
  startRound.timer = setInterval(hud, 250);
}

function elapsed() { return ((r.done ? r.end : performance.now()) - r.start) / 1000; }

function calc() {
  const timeLoss = TIME_MAX * Math.min(1, elapsed() / TIME_FULL);
  const base = Math.max(0, START - timeLoss - r.wrong * WRONG - r.hints * HINT);
  return { timeLoss, base, total: Math.round(base * (r.hard ? HARD_MULT : 1)) };
}

function hud() {
  if (!r) return;
  $("h-time").textContent = Math.floor(elapsed());
  $("h-score").textContent = g.total;
  $("h-lives").textContent = g.lives;
  $("h-wrong").textContent = r.wrong;
  $("h-hints").textContent = r.hints;
  const now = r.done ? 0 : calc().total;
  $("h-now").textContent = now;
  if (!r.done && now <= 0) endRound(false, "Очки за раунд закончились.");
}

/* ---------- drawing ---------- */

function draw() {
  const cv = $("cv"), ctx = cv.getContext("2d");
  const { cs, img, a } = r;
  ctx.imageSmoothingEnabled = r.scale < 1;
  ctx.fillStyle = "#0e0e0e";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);

  for (let cy = 0; cy < a.rows; cy++) {
    for (let cx = 0; cx < a.cols; cx++) {
      const i = cy * a.cols + cx;
      if (a.empty[i] || r.done || r.opened[i]) continue;
      ctx.fillStyle = HIDDEN;
      ctx.fillRect(cx * cs, cy * cs, cs + 0.5, cs + 0.5);
    }
  }

  if (cs >= 8) {
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= a.cols; x++) { ctx.moveTo(Math.round(x * cs) + 0.5, 0); ctx.lineTo(Math.round(x * cs) + 0.5, cv.height); }
    for (let y = 0; y <= a.rows; y++) { ctx.moveTo(0, Math.round(y * cs) + 0.5); ctx.lineTo(cv.width, Math.round(y * cs) + 0.5); }
    ctx.stroke();
  }

  for (let i = 0; i < r.opened.length; i++) {
    if (!r.opened[i] || r.done) continue;
    ctx.strokeStyle = r.hard ? TEMP_COLOR[r.temp[i]] : "#d98a8a";
    ctx.lineWidth = r.hard ? 3 : 2;
    ctx.strokeRect((i % a.cols) * cs + 1, Math.floor(i / a.cols) * cs + 1, cs - 2, cs - 2);
  }

  if (r.done) {
    ctx.strokeStyle = "#9ccf9c";
    ctx.lineWidth = 3;
    ctx.strokeRect((r.target % a.cols) * cs + 1.5, Math.floor(r.target / a.cols) * cs + 1.5, cs - 3, cs - 3);
  } else if (r.hover >= 0 && !a.empty[r.hover] && !r.opened[r.hover]) {
    ctx.strokeStyle = "#d8d8d8";
    ctx.lineWidth = 2;
    ctx.strokeRect((r.hover % a.cols) * cs + 1, Math.floor(r.hover / a.cols) * cs + 1, cs - 2, cs - 2);
  }
}

function cellAt(e) {
  const cv = $("cv"), box = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - box.left) * cv.width / box.width / r.cs);
  const y = Math.floor((e.clientY - box.top) * cv.height / box.height / r.cs);
  return x >= 0 && y >= 0 && x < r.a.cols && y < r.a.rows ? y * r.a.cols + x : -1;
}

$("cv").addEventListener("mousemove", e => {
  if (!r || r.done) return;
  const i = cellAt(e);
  if (i !== r.hover) { r.hover = i; draw(); }
});
$("cv").addEventListener("mouseleave", () => { if (r && !r.done && r.hover !== -1) { r.hover = -1; draw(); } });

$("cv").addEventListener("click", e => {
  if (!r || r.done) return;
  const i = cellAt(e);
  if (i < 0 || r.a.empty[i] || r.opened[i]) return;
  if (i === r.target) { r.opened[i] = 1; endRound(true); return; }
  r.opened[i] = 1;
  r.wrong++;
  const m = $("g-msg");
  m.className = "note bad";
  if (r.hard) {
    r.temp[i] = temperature(i);
    m.textContent = `${TEMP_LABEL[r.temp[i]]}. Очки сняты.`;
  } else {
    m.textContent = `Не тот тайл, он открыт. Очки сняты.`;
  }
  drawWindow();
  draw();
  hud();
});

/* ---------- hints ---------- */

$("t-hint").onclick = () => {
  if (!r || r.done) return;
  const { cols, rows, empty } = r.a;
  const tx = r.target % cols, ty = Math.floor(r.target / cols);
  const options = DIRS.filter(([dx, dy]) => {
    const x = tx + dx, y = ty + dy;
    return x >= 0 && y >= 0 && x < cols && y < rows && !empty[y * cols + x] && !r.hinted.includes(y * cols + x);
  });
  if (!options.length) {
    $("g-msg").className = "note bad";
    $("g-msg").textContent = "Рядом с искомым тайлом больше нет непустых соседей для подсказки.";
    $("t-hint").disabled = true;
    return;
  }
  const [dx, dy] = options[Math.floor(Math.random() * options.length)];
  r.hinted.push((ty + dy) * cols + tx + dx);
  r.hints++;
  drawWindow();
  $("g-msg").textContent = "";
  if (options.length === 1) $("t-hint").disabled = true;
  hud();
};

$("t-giveup").onclick = () => { if (r && !r.done) endRound(false); };

/* ---------- end of round ---------- */

function endRound(won, reason) {
  if (r.done) return;
  r.done = true;
  r.end = performance.now();
  clearInterval(startRound.timer);
  const c = calc();
  const pts = won ? c.total : 0;
  if (!won) g.lives--;
  const over = g.lives <= 0 || g.i + 1 >= g.items.length;
  g.total += pts;
  g.log.push({ name: r.item.name, pts });
  $("cv").className = "done";
  draw();
  drawWindow();
  hud();
  setControls(false);

  $("r-title").textContent = (won ? "Верно: " : "Это был(а): ") + r.item.name;
  $("r-detail").textContent = won
    ? `Ошибок: ${r.wrong} (минус ${r.wrong * WRONG}), подсказок: ${r.hints} (минус ${r.hints * HINT}), время ${Math.round(elapsed())} с `
      + `(минус ${Math.round(c.timeLoss)})${r.hard ? ", сложность x" + HARD_MULT : ""}. Итого за раунд: ${pts}.`
    : (reason || "Вы сдались.") + " Очки за раунд не начислены, потеряна жизнь"
      + (g.lives <= 0 ? ". Жизней не осталось - игра окончена." : `. Осталось жизней: ${g.lives}.`);
  $("g-msg").className = "note " + (won ? "good" : "bad");
  $("g-msg").textContent = won ? `+${pts} очков` : (reason || "Сдались");
  $("r-view").href = `viewer/?map=${r.item.kind}-${encodeURIComponent(r.item.id)}&view=render`;
  $("r-next").textContent = over ? "Итоги" : "Дальше";
  $("result").hidden = false;
  $("r-next").focus();
}

$("r-next").onclick = () => {
  if (g.lives > 0 && g.i + 1 < g.items.length) { g.i++; startRound(); } else { finish(); }
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
