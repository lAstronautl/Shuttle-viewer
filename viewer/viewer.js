const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const stage = $("stage"), img = $("img");
const view = { x: 0, y: 0, zoom: 1 };
const LIMIT = { min: 0.1, max: 64 };
let maps = {}, current = null;
let mode = params.get("view") || "render"; // "render" | "mini", shared with the catalog
if (!params.get("view")) {
  try { mode = localStorage.getItem("mode") || "render"; } catch (e) { /* storage may be blocked */ }
}
if (mode !== "mini") mode = "render";

function apply() {
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  img.style.imageRendering = view.zoom >= 1 ? "pixelated" : "auto";
}

function fit() {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w) return;
  const fitMax = img.src.endsWith(".png") ? 40 : 4; // mini maps are tiny (1 px per tile)
  view.zoom = Math.min(Math.max(Math.min((innerWidth - 40) / w, (innerHeight - 100) / h), LIMIT.min), fitMax);
  view.x = (innerWidth - w * view.zoom) / 2;
  view.y = (innerHeight - h * view.zoom) / 2;
  apply();
}

function zoomAt(px, py, factor) {
  const z = Math.min(Math.max(view.zoom * factor, LIMIT.min), LIMIT.max);
  const k = z / view.zoom;
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.zoom = z;
  apply();
}

function pan(dx, dy) {
  view.x += dx;
  view.y += dy;
  apply();
}

function load(id) {
  if (!(id in maps)) return;
  current = id;
  const m = maps[id];
  $("title").textContent = m.name || id;
  document.title = `${m.name || id} | Shuttle Viewer`;
  document.querySelectorAll("#list a").forEach(a => a.classList.toggle("on", a.dataset.id === id));
  const [first, second] = mode === "mini" ? [m.mini, m.url] : [m.url, m.mini];
  img.onload = fit;
  img.src = first || second;
  document.querySelectorAll("#mode button").forEach(b => {
    b.classList.toggle("on", b.dataset.mode === mode);
    b.disabled = !(b.dataset.mode === "mini" ? m.mini : m.url);
  });
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("mode", m); } catch (e) { /* ignore */ }
  const u = new URLSearchParams(location.search);
  u.set("view", m);
  history.replaceState("", "", "?" + u);
  load(current);
}

function buildList(groups) {
  const list = $("list");
  for (const [group, items] of Object.entries(groups)) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = group;
    d.appendChild(s);
    for (const [id, m] of Object.entries(items)) {
      maps[id] = m;
      const a = document.createElement("a");
      a.textContent = m.name || id;
      a.href = `?map=${encodeURIComponent(id)}&view=${mode}`;
      a.dataset.id = id;
      a.onclick = e => {
        e.preventDefault();
        history.pushState("", "", `?map=${encodeURIComponent(id)}&view=${mode}`);
        load(id);
      };
      d.appendChild(a);
    }
    list.appendChild(d);
  }
}

// mouse / touch
let drag = null, pinch = null;
stage.addEventListener("pointerdown", e => {
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("drag");
  (stage.pts ||= new Map()).set(e.pointerId, { x: e.clientX, y: e.clientY });
  drag = { x: e.clientX - view.x, y: e.clientY - view.y };
  pinch = null;
});
stage.addEventListener("pointermove", e => {
  const pts = stage.pts;
  if (!pts || !pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch);
    pinch = dist;
  } else if (drag) {
    view.x = e.clientX - drag.x;
    view.y = e.clientY - drag.y;
    apply();
  }
});
const end = e => {
  stage.pts?.delete(e.pointerId);
  if (!stage.pts?.size) { stage.classList.remove("drag"); drag = null; }
  pinch = null;
  if (stage.pts?.size === 1) { const p = [...stage.pts.values()][0]; drag = { x: p.x - view.x, y: p.y - view.y }; }
};
stage.addEventListener("pointerup", end);
stage.addEventListener("pointercancel", end);
stage.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });
stage.addEventListener("dblclick", fit);

// keyboard
const STEP = 75;
document.addEventListener("keydown", e => {
  const k = e.key, fast = k !== k.toLowerCase() && k.length === 1 && /[a-z]/i.test(k) ? 2 : 1;
  const s = STEP * fast;
  switch (k) {
    case "-": case "_": zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.4); break;
    case "=": case "+": zoomAt(innerWidth / 2, innerHeight / 2, 1.4); break;
    case "h": case "H": case "a": case "A": case "ArrowLeft": pan(s, 0); break;
    case "l": case "L": case "d": case "D": case "ArrowRight": pan(-s, 0); break;
    case "k": case "K": case "w": case "W": case "ArrowUp": pan(0, s); break;
    case "j": case "J": case "s": case "S": case "ArrowDown": pan(0, -s); break;
    default: return;
  }
  e.preventDefault();
});

// buttons
$("toggle").onclick = () => { $("list").hidden = !$("list").hidden; };
$("zin").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.4);
$("zout").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.4);
$("fit").onclick = fit;
document.querySelectorAll("#mode button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
addEventListener("resize", fit);
addEventListener("popstate", () => load(new URLSearchParams(location.search).get("map")));

fetch("maps.json").then(r => r.json()).then(conf => {
  buildList(conf.maps);
  load(params.get("map") || conf.main);
});
