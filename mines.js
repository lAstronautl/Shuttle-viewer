const $ = id => document.getElementById(id);

// Field "ship": the board has the shape of a shuttle / POI mini map (1 mini map pixel = 1 cell), cells are tinted
// with the mini map colours when opened. Field "classic": a plain rectangle.
const DENSITY = { easy: 0.12, medium: 0.17, hard: 0.22 };
const CLASSIC = { easy: [9, 9, 10], medium: [16, 16, 40], hard: [30, 16, 99] };
const LONG_PRESS_MS = 420;
const RANDOM_MAX = { w: 60, h: 40 }; // "random map" skips mini maps bigger than this

const prefs = { field: "ship", preset: "easy", mapId: "", density: 15, w: 12, h: 12, m: 20 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("minesPrefs") || "{}")); } catch (e) { /* ignore */ }
const save = () => { try { localStorage.setItem("minesPrefs", JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

let data = null;             // shuttles.json
let W, H, M, valid, tint;    // board size, mines, valid[i] (cell exists), tint[i] = [r,g,b]
let cells, state, flagMode = false, subject = null;
let t0 = 0, timer = null, opened = 0, flags = 0, validCount = 0, token = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.floor(+v) || a));

function entries() {
  if (!data) return [];
  return [...data.shuttles.map(s => ({ ...s, kind: "ship" })), ...(data.pois || []).map(s => ({ ...s, kind: "poi" }))]
    .filter(s => s.minimap);
}

function mapChoices() {
  const kind = prefs.field === "poi" ? "poi" : "ship";
  return entries().filter(s => s.kind === kind && s.group !== "Custom")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function bestKey() {
  const f = prefs.field === "classic" && prefs.preset === "custom" ? `c${prefs.w}x${prefs.h}x${prefs.m}` : prefs.preset;
  return `minesBest:${prefs.field}:${f}`;
}
function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

function neighbors(i) {
  const x = i % W, y = (i - x) / W, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!(dx || dy)) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && valid[ny * W + nx]) out.push(ny * W + nx);
    }
  }
  return out;
}

/* ---------- setup ---------- */

function syncSetup() {
  const ship = prefs.field !== "classic";
  document.querySelectorAll("#m-field button").forEach(b => b.classList.toggle("on", b.dataset.f === prefs.field));
  document.querySelectorAll("#m-preset button").forEach(b => b.classList.toggle("on", b.dataset.p === prefs.preset));
  $("m-map-row").hidden = !ship;
  $("m-custom-classic").hidden = ship || prefs.preset !== "custom";
  $("m-custom-ship").hidden = !ship || prefs.preset !== "custom";
  $("m-preset").querySelector('[data-p=easy]').textContent = ship ? "Лёгкая 12%" : "Новичок 9x9";
  $("m-preset").querySelector('[data-p=medium]').textContent = ship ? "Средняя 17%" : "Любитель 16x16";
  $("m-preset").querySelector('[data-p=hard]').textContent = ship ? "Сложная 22%" : "Эксперт 30x16";
  for (const [id, key] of [["c-w", "w"], ["c-h", "h"], ["c-m", "m"], ["c-d", "density"]]) $(id).value = prefs[key];

  if (ship && data) {
    const sel = $("m-map"), list = mapChoices();
    const want = list.some(s => `${s.kind}-${s.id}` === prefs.mapId) ? prefs.mapId : "";
    sel.replaceChildren(Object.assign(document.createElement("option"), { value: "", textContent: "Случайная" }),
      ...list.map(s => Object.assign(document.createElement("option"), { value: `${s.kind}-${s.id}`, textContent: s.name })));
    sel.value = want;
    prefs.mapId = want;
  }
}

/* ---------- game ---------- */

function loadMini(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("не удалось загрузить миникарту"));
    im.src = src;
  });
}

async function shapeOf(item) {
  const im = await loadMini(item.minimap);
  const c = document.createElement("canvas");
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const ok = new Uint8Array(c.width * c.height), col = [];
  for (let i = 0; i < ok.length; i++) {
    if (px[i * 4 + 3] > 10) { ok[i] = 1; col[i] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]; }
  }
  return { w: c.width, h: c.height, ok, col };
}

function pickItem() {
  const list = mapChoices();
  if (prefs.mapId) return list.find(s => `${s.kind}-${s.id}` === prefs.mapId) || null;
  return null; // random is decided after the shapes are known
}

async function newGame() {
  const my = ++token;
  clearInterval(timer);
  state = "loading";
  $("m-msg").className = "note";
  $("m-msg").textContent = "";
  syncSetup();
  subject = null;

  if (prefs.field === "classic") {
    [W, H, M] = prefs.preset === "custom"
      ? [clamp(prefs.w, 5, 50), clamp(prefs.h, 5, 30), 0]
      : CLASSIC[prefs.preset];
    if (prefs.preset === "custom") M = clamp(prefs.m, 1, W * H - 9);
    valid = new Uint8Array(W * H).fill(1);
    tint = null;
  } else {
    if (!data) { $("m-msg").textContent = "Загрузка..."; return; }
    let item = pickItem();
    if (!item) {
      const pool = mapChoices().filter(s => s.minimap);
      // random: try a few until the shape is not too big
      for (let k = 0; k < 8 && pool.length; k++) {
        const cand = pool[Math.floor(Math.random() * pool.length)];
        const sh = await shapeOf(cand).catch(() => null);
        if (my !== token) return;
        if (sh && sh.w <= RANDOM_MAX.w && sh.h <= RANDOM_MAX.h) { item = cand; break; }
      }
    }
    if (!item) { $("m-msg").textContent = "Нет подходящих миникарт."; return; }
    let shape;
    try { shape = await shapeOf(item); } catch (e) { $("m-msg").textContent = e.message; return; }
    if (my !== token) return;
    subject = item;
    W = shape.w; H = shape.h; valid = shape.ok; tint = shape.col;
    const count = valid.reduce((a, b) => a + b, 0);
    const dens = prefs.preset === "custom" ? clamp(prefs.density, 5, 40) / 100 : DENSITY[prefs.preset];
    M = Math.max(1, Math.min(count - 10, Math.round(count * dens)));
  }

  validCount = valid.reduce((a, b) => a + b, 0);
  cells = Array.from({ length: W * H }, () => ({ mine: false, open: false, flag: false, n: 0 }));
  state = "ready"; opened = 0; flags = 0;
  $("m-time").textContent = "0";
  const best = getBest();
  $("m-best").textContent = best ? `Лучшее время: ${best} с` : "";

  const board = $("m-board");
  const size = Math.max(14, Math.min(32, Math.floor(($("m-wrap").clientWidth - 24 - 2 * (W - 1)) / W)));
  board.style.setProperty("--c", `${size}px`);
  board.style.gridTemplateColumns = `repeat(${W}, ${size}px)`;
  board.replaceChildren(...cells.map((_, i) => {
    if (!valid[i]) { const g = document.createElement("div"); g.className = "mg"; return g; }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mc";
    b.dataset.i = i;
    b.setAttribute("role", "gridcell");
    return b;
  }));
  $("m-subject").textContent = subject ? "Миникарта скрыта до конца игры: откройте клетки, и корабль проявится." : "";
  updateLeft();
}

function placeMines(safe) {
  const banned = new Set([safe, ...neighbors(safe)]);
  const all = [];
  for (let i = 0; i < cells.length; i++) if (valid[i]) all.push(i);
  let pool = all.filter(i => !banned.has(i));
  if (pool.length < M) pool = all.filter(i => i !== safe);
  for (let k = pool.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  pool.slice(0, M).forEach(i => { cells[i].mine = true; });
  all.forEach(i => { cells[i].n = neighbors(i).filter(j => cells[j].mine).length; });
}

function paint(i, full) {
  if (!valid[i]) return;
  const c = cells[i], el = $("m-board").children[i];
  let cls = "mc";
  if (c.open) cls += ` open${c.mine ? " mine" : c.n ? ` n${c.n}` : ""}`;
  else if (c.flag) cls += " flag";
  el.className = cls;
  el.textContent = c.open && !c.mine && c.n ? c.n : "";
  if (tint && c.open && !c.mine) {
    const k = full ? 1 : 0.5, [r, g, b] = tint[i];
    el.style.background = `rgb(${Math.round(r * k + 28 * (1 - k))},${Math.round(g * k + 28 * (1 - k))},${Math.round(b * k + 28 * (1 - k))})`;
  } else {
    el.style.background = "";
  }
}

function updateLeft() { $("m-left").textContent = M - flags; }
function tick() { $("m-time").textContent = Math.floor((performance.now() - t0) / 1000); }

function reveal(start) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop(), c = cells[i];
    if (c.open || c.flag) continue;
    c.open = true; opened++;
    paint(i);
    if (!c.mine && c.n === 0) stack.push(...neighbors(i));
  }
}

function open(i) {
  const c = cells[i];
  if (state === "won" || state === "lost" || state === "loading" || c.open || c.flag) return;
  if (state === "ready") {
    placeMines(i);
    state = "play";
    t0 = performance.now();
    timer = setInterval(tick, 250);
  }
  if (c.mine) return lose(i);
  reveal(i);
  checkWin();
}

function chord(i) {
  const c = cells[i];
  if (state !== "play" || !c.open || !c.n) return;
  const around = neighbors(i);
  if (around.filter(j => cells[j].flag).length !== c.n) return;
  for (const j of around) {
    if (cells[j].flag || cells[j].open) continue;
    if (cells[j].mine) return lose(j);
    reveal(j);
  }
  checkWin();
}

function toggleFlag(i) {
  const c = cells[i];
  if (state === "won" || state === "lost" || state === "loading" || c.open) return;
  if (!c.flag && flags >= M) return;
  c.flag = !c.flag;
  flags += c.flag ? 1 : -1;
  paint(i);
  updateLeft();
}

function describe() {
  if (!subject) return "";
  const url = `viewer/?map=${subject.kind}-${encodeURIComponent(subject.id)}&view=mini`;
  $("m-subject").replaceChildren(document.createTextNode("Это был(а): " + subject.name + ". "),
    Object.assign(document.createElement("a"), { href: url, target: "_blank", textContent: "Открыть в просмотрщике" }));
}

function lose(hit) {
  state = "lost";
  clearInterval(timer);
  tick();
  cells.forEach((c, i) => {
    if (!valid[i]) return;
    if (c.mine && !c.flag) { c.open = true; paint(i); }
    if (!c.mine && c.flag) { paint(i); $("m-board").children[i].classList.add("wrong"); }
  });
  $("m-board").children[hit].classList.add("boom");
  $("m-msg").className = "note bad";
  $("m-msg").textContent = "Мина! Игра окончена.";
  describe();
}

function checkWin() {
  if (opened !== validCount - M) return;
  state = "won";
  clearInterval(timer);
  tick();
  cells.forEach((c, i) => { if (valid[i] && c.mine && !c.flag) { c.flag = true; flags++; } });
  cells.forEach((c, i) => paint(i, true));
  updateLeft();
  const secs = Math.max(1, Math.round((performance.now() - t0) / 1000));
  const best = getBest();
  const record = !best || secs < best;
  if (record) { try { localStorage.setItem(bestKey(), String(secs)); } catch (e) { /* ignore */ } }
  $("m-best").textContent = `Лучшее время: ${record ? secs : best} с`;
  $("m-msg").className = "note good";
  $("m-msg").textContent = `Победа за ${secs} с${record ? ". Новый рекорд!" : "."}`;
  describe();
}

/* ---------- input ---------- */

const board = $("m-board");
const cellOf = e => { const b = e.target.closest(".mc"); return b ? +b.dataset.i : -1; };

let press = null;
board.addEventListener("pointerdown", e => {
  const i = cellOf(e);
  if (i < 0) return;
  press = { i, long: false, button: e.button, type: e.pointerType };
  if (e.pointerType !== "mouse") {
    press.timer = setTimeout(() => { press.long = true; toggleFlag(i); if (navigator.vibrate) navigator.vibrate(20); }, LONG_PRESS_MS);
  }
});
board.addEventListener("pointerup", e => {
  if (!press) return;
  clearTimeout(press.timer);
  const p = press; press = null;
  const i = cellOf(e);
  if (i < 0 || i !== p.i || p.long) return;
  if (p.type === "mouse") {
    if (p.button === 0) {
      if (flagMode) toggleFlag(i);
      else if (cells[i].open) chord(i);
      else open(i);
    } else if (p.button === 1) {
      chord(i);
    }
  } else if (flagMode) {
    toggleFlag(i);
  } else if (cells[i].open) {
    chord(i);
  } else {
    open(i);
  }
});
board.addEventListener("pointercancel", () => { if (press) clearTimeout(press.timer); press = null; });
board.addEventListener("pointerleave", () => { if (press) clearTimeout(press.timer); press = null; });
board.addEventListener("contextmenu", e => {
  e.preventDefault();
  const i = cellOf(e);
  if (i >= 0 && !(press && press.type !== "mouse")) toggleFlag(i);
});
board.addEventListener("auxclick", e => e.preventDefault());

$("m-flagmode").onclick = () => {
  flagMode = !flagMode;
  $("m-flagmode").setAttribute("aria-pressed", flagMode);
  $("m-flagmode").textContent = "Режим флажка: " + (flagMode ? "вкл" : "выкл");
};
$("m-new").onclick = newGame;
document.querySelectorAll("#m-field button").forEach(b => b.onclick = () => {
  prefs.field = b.dataset.f; prefs.mapId = ""; save(); newGame();
});
document.querySelectorAll("#m-preset button").forEach(b => b.onclick = () => { prefs.preset = b.dataset.p; save(); newGame(); });
$("m-map").onchange = e => { prefs.mapId = e.target.value; save(); newGame(); };
for (const [id, key] of [["c-w", "w"], ["c-h", "h"], ["c-m", "m"], ["c-d", "density"]]) {
  $(id).onchange = e => { prefs[key] = +e.target.value; save(); newGame(); };
}
document.addEventListener("keydown", e => { if (e.code === "KeyR" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) newGame(); });

if (!["ship", "poi", "classic"].includes(prefs.field)) prefs.field = "ship";
if (!["easy", "medium", "hard", "custom"].includes(prefs.preset)) prefs.preset = "easy";

fetch("shuttles.json").then(r => r.json()).then(d => { data = d; })
  .catch(() => { if (prefs.field !== "classic") { prefs.field = "classic"; } })
  .finally(() => newGame());
