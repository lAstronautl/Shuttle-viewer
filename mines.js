const $ = id => document.getElementById(id);

// Field "ship": the board has the shape of a shuttle / POI mini map (1 mini map pixel = 1 cell), cells are tinted
// with the mini map colours when opened. Mines sit only under grey and green cells, and only those cells show numbers.
const DENSITY = { easy: 0.12, medium: 0.17, hard: 0.22 };
const LONG_PRESS_MS = 420;
const RANDOM_MAX = { w: 60, h: 40 }; // "random map" skips mini maps bigger than this

const prefs = { field: "ship", preset: "easy", mapId: "", density: 15 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("minesPrefs") || "{}")); } catch (e) { /* ignore */ }
const save = () => { try { localStorage.setItem("minesPrefs", JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

let data = null;             // shuttles.json
let W, H, M, valid, tint, numbered; // numbered[i]: grey/green cell (can hold a mine, shows a number)
let cells, state, subject = null;
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
  return `minesBest:${prefs.field}:${prefs.preset}`;
}
function scoreKey() { return `minesScore:${prefs.field}:${prefs.preset}`; }
function getBestScore() { try { return +localStorage.getItem(scoreKey()) || 0; } catch (e) { return 0; } }
function bestLine() {
  const t = getBest(), p = getBestScore();
  return [p ? `Рекорд очков: ${p}` : "", t ? `лучшее время: ${t} с` : ""].filter(Boolean).join(", ");
}

// score = size part (cells and mines) x difficulty (mine density) x speed (0.5 .. 1.5 against a par time)
function calcScore(secs) {
  const density = M / Math.max(1, numbered.reduce((a, b) => a + b, 0));
  const diff = Math.max(0.5, Math.min(2.5, density / 0.12));   // 12% = x1, 22% = x1.83
  const base = validCount * 5 + M * 25;
  const par = M * 3 + validCount * 0.5;                          // seconds for an average run
  const speed = 0.5 + Math.max(0, 1 - secs / par);
  return { score: Math.round(base * diff * speed), base, diff, speed, par };
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
  document.querySelectorAll("#m-field button").forEach(b => b.classList.toggle("on", b.dataset.f === prefs.field));
  document.querySelectorAll("#m-preset button").forEach(b => b.classList.toggle("on", b.dataset.p === prefs.preset));
  $("m-custom-ship").hidden = prefs.preset !== "custom";
  $("m-preset").querySelector('[data-p=easy]').textContent = "Лёгкая 12%";
  $("m-preset").querySelector('[data-p=medium]').textContent = "Средняя 17%";
  $("m-preset").querySelector('[data-p=hard]').textContent = "Сложная 22%";
  $("c-d").value = prefs.density;

  if (data) {
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

// mini map palette: grey (floor/walls/space) and green (rooms) take mines and numbers; orange, blue, yellow do not
function isGreyOrGreen([r, g, b]) {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread < 45) return true;                       // grey
  return g > r + 40 && g > b + 40;                     // green
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
  const num = new Uint8Array(ok.length);
  for (let i = 0; i < ok.length; i++) if (ok[i]) num[i] = isGreyOrGreen(col[i]) ? 1 : 0;
  return { w: c.width, h: c.height, ok, col, num };
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

  {
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
    W = shape.w; H = shape.h; valid = shape.ok; tint = shape.col; numbered = shape.num;
    const count = numbered.reduce((a, b) => a + b, 0);
    const dens = prefs.preset === "custom" ? clamp(prefs.density, 5, 40) / 100 : DENSITY[prefs.preset];
    M = Math.max(1, Math.min(Math.max(1, count - 10), Math.round(count * dens)));
  }

  validCount = valid.reduce((a, b) => a + b, 0);
  cells = Array.from({ length: W * H }, () => ({ mine: false, open: false, flag: false, n: 0 }));
  state = "ready"; opened = 0; flags = 0;
  $("m-time").textContent = "0";
  const best = getBest();
  $("m-best").textContent = bestLine();

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
  for (let i = 0; i < cells.length; i++) if (valid[i] && numbered[i]) all.push(i);
  let pool = all.filter(i => !banned.has(i));
  if (pool.length < M) pool = all.filter(i => i !== safe);
  for (let k = pool.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  pool.slice(0, M).forEach(i => { cells[i].mine = true; });
  cells.forEach((c, i) => { if (valid[i]) c.n = neighbors(i).filter(j => cells[j].mine).length; });
}

function paint(i, full) {
  if (!valid[i]) return;
  const c = cells[i], el = $("m-board").children[i];
  let cls = "mc";
  if (c.open) cls += ` open${c.mine ? " mine" : numbered[i] && c.n ? ` n${c.n}` : ""}`;
  else if (c.flag) cls += " flag";
  el.className = cls;
  el.textContent = c.open && !c.mine && numbered[i] && c.n ? c.n : "";
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
    if (!c.mine && numbered[i] && c.n === 0) stack.push(...neighbors(i));
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
  if (state !== "play" || !c.open || !c.n || !numbered[i]) return;
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
  const sc = calcScore(secs);
  const bestT = getBest(), bestP = getBestScore();
  try {
    if (!bestT || secs < bestT) localStorage.setItem(bestKey(), String(secs));
    if (sc.score > bestP) localStorage.setItem(scoreKey(), String(sc.score));
  } catch (e) { /* ignore */ }
  $("m-best").textContent = bestLine();
  $("m-msg").className = "note good";
  $("m-msg").textContent = `Победа за ${secs} с: ${sc.score} очков (размер ${sc.base} x сложность ${sc.diff.toFixed(2)} x скорость ${sc.speed.toFixed(2)})`
    + (sc.score > bestP ? ". Новый рекорд!" : ".");
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
      if (cells[i].open) chord(i);
      else open(i);
    } else if (p.button === 1) {
      chord(i);
    }
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

$("m-new").onclick = newGame;
document.querySelectorAll("#m-field button").forEach(b => b.onclick = () => {
  prefs.field = b.dataset.f; prefs.mapId = ""; save(); newGame();
});
document.querySelectorAll("#m-preset button").forEach(b => b.onclick = () => { prefs.preset = b.dataset.p; save(); newGame(); });
$("m-map").onchange = e => { prefs.mapId = e.target.value; save(); newGame(); };
$("c-d").onchange = e => { prefs.density = +e.target.value; save(); newGame(); };
document.addEventListener("keydown", e => { if (e.code === "KeyR" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) newGame(); });

if (!["ship", "poi"].includes(prefs.field)) prefs.field = "ship";
if (!["easy", "medium", "hard", "custom"].includes(prefs.preset)) prefs.preset = "easy";

fetch("shuttles.json").then(r => r.json()).then(d => { data = d; })
  .catch(() => { $("m-msg").textContent = "Не удалось загрузить shuttles.json"; })
  .finally(() => newGame());
