const $ = id => document.getElementById(id);

const PRESETS = { easy: [9, 9, 10], medium: [16, 16, 40], hard: [30, 16, 99] };
const LONG_PRESS_MS = 420;

let preset = "easy";
try { preset = localStorage.getItem("minesPreset") || "easy"; } catch (e) { /* ignore */ }
let custom = { w: 12, h: 12, m: 20 };
try { Object.assign(custom, JSON.parse(localStorage.getItem("minesCustom") || "{}")); } catch (e) { /* ignore */ }

let W, H, M;
let cells;      // {mine, open, flag, n}
let state;      // "ready" | "play" | "won" | "lost"
let flagMode = false;
let t0 = 0, timer = null, opened = 0, flags = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.floor(+v) || a));

function dims() {
  if (preset === "custom") {
    const w = clamp(custom.w, 5, 50), h = clamp(custom.h, 5, 30);
    return [w, h, clamp(custom.m, 1, w * h - 9)];
  }
  return PRESETS[preset];
}

function bestKey() { return `minesBest:${preset === "custom" ? `c${W}x${H}x${M}` : preset}`; }
function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

function neighbors(i) {
  const x = i % W, y = (i - x) / W, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H) out.push((y + dy) * W + x + dx);
    }
  }
  return out;
}

function newGame() {
  [W, H, M] = dims();
  clearInterval(timer);
  cells = Array.from({ length: W * H }, () => ({ mine: false, open: false, flag: false, n: 0 }));
  state = "ready"; opened = 0; flags = 0;
  $("m-time").textContent = "0";
  $("m-msg").textContent = "";
  $("m-msg").className = "note";
  document.querySelectorAll("#m-preset button").forEach(b => b.classList.toggle("on", b.dataset.p === preset));
  $("m-custom").hidden = preset !== "custom";
  const best = getBest();
  $("m-best").textContent = best ? `Лучшее время: ${best} с` : "";

  const board = $("m-board");
  board.style.gridTemplateColumns = `repeat(${W}, var(--c, 28px))`;
  board.style.setProperty("--c", `${Math.max(20, Math.min(32, Math.floor((Math.min(innerWidth, 1100) - 60) / W)))}px`);
  board.replaceChildren(...cells.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mc";
    b.dataset.i = i;
    b.setAttribute("role", "gridcell");
    return b;
  }));
  updateLeft();
}

function placeMines(safe) {
  const banned = new Set([safe, ...neighbors(safe)]);
  const free = [];
  for (let i = 0; i < cells.length; i++) if (!banned.has(i)) free.push(i);
  // fewer free cells than mines (tiny custom board): keep only the clicked cell safe
  const pool = free.length >= M ? free : cells.map((_, i) => i).filter(i => i !== safe);
  for (let k = pool.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  pool.slice(0, M).forEach(i => { cells[i].mine = true; });
  cells.forEach((c, i) => { c.n = neighbors(i).filter(j => cells[j].mine).length; });
}

function paint(i) {
  const c = cells[i], el = $("m-board").children[i];
  let cls = "mc";
  if (c.open) cls += ` open${c.mine ? " mine" : c.n ? ` n${c.n}` : ""}`;
  else if (c.flag) cls += " flag";
  el.className = cls;
  el.textContent = c.open && !c.mine && c.n ? c.n : "";
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
  if (state === "won" || state === "lost" || c.open || c.flag) return;
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
  if (state === "won" || state === "lost" || c.open) return;
  if (!c.flag && flags >= M) return; // no more flags than mines
  c.flag = !c.flag;
  flags += c.flag ? 1 : -1;
  paint(i);
  updateLeft();
}

function lose(hit) {
  state = "lost";
  clearInterval(timer);
  tick();
  cells.forEach((c, i) => {
    if (c.mine && !c.flag) { c.open = true; paint(i); }
    if (!c.mine && c.flag) { paint(i); $("m-board").children[i].classList.add("wrong"); }
  });
  $("m-board").children[hit].classList.add("boom");
  $("m-msg").className = "note bad";
  $("m-msg").textContent = "Мина! Игра окончена.";
}

function checkWin() {
  if (opened !== W * H - M) return;
  state = "won";
  clearInterval(timer);
  tick();
  cells.forEach((c, i) => { if (c.mine && !c.flag) { c.flag = true; flags++; paint(i); } });
  updateLeft();
  const secs = Math.max(1, Math.round((performance.now() - t0) / 1000));
  const best = getBest();
  const record = !best || secs < best;
  if (record) { try { localStorage.setItem(bestKey(), String(secs)); } catch (e) { /* ignore */ } }
  $("m-best").textContent = `Лучшее время: ${record ? secs : best} с`;
  $("m-msg").className = "note good";
  $("m-msg").textContent = `Победа за ${secs} с${record ? ". Новый рекорд!" : "."}`;
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
document.querySelectorAll("#m-preset button").forEach(b => b.onclick = () => {
  preset = b.dataset.p;
  try { localStorage.setItem("minesPreset", preset); } catch (e) { /* ignore */ }
  newGame();
});
for (const [id, key] of [["c-w", "w"], ["c-h", "h"], ["c-m", "m"]]) {
  $(id).value = custom[key];
  $(id).onchange = e => {
    custom[key] = +e.target.value;
    try { localStorage.setItem("minesCustom", JSON.stringify(custom)); } catch (err) { /* ignore */ }
    newGame();
  };
}
document.addEventListener("keydown", e => { if (e.code === "KeyR" && !(e.target instanceof HTMLInputElement)) newGame(); });

if (!(preset in PRESETS) && preset !== "custom") preset = "easy";
newGame();
