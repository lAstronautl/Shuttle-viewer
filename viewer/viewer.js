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

// keyboard: movement only on WASD; e.code is the physical key, so it works on any layout (e.g. Russian)
const STEP = 75;
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const s = STEP * (e.shiftKey ? 2 : 1);
  switch (e.code) {
    case "KeyA": pan(s, 0); break;
    case "KeyD": pan(-s, 0); break;
    case "KeyW": pan(0, s); break;
    case "KeyS": pan(0, -s); break;
    case "Minus": case "NumpadSubtract": zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.4); break;
    case "Equal": case "NumpadAdd": zoomAt(innerWidth / 2, innerHeight / 2, 1.4); break;
    default: return;
  }
  e.preventDefault();
});

// download: the render and the mini map together in one zip (stored, no compression; no external libraries)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return buf => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
})();

function makeZip(files) { // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = CRC(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

async function download() {
  const m = maps[current];
  if (!m) return;
  const base = (m.name || current).replace(/[<>:"/\\|?*]/g, "_");
  const btn = $("dl");
  btn.disabled = true;
  try {
    const files = [];
    for (const [url, name] of [[m.url, `Рендер/${base}.webp`], [m.mini, `Миникарта/${base} (mini).png`]]) {
      if (!url) continue;
      files.push({ name, data: new Uint8Array(await (await fetch(url)).arrayBuffer()) });
    }
    if (!files.length) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(makeZip(files));
    a.download = base + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally {
    btn.disabled = false;
  }
}

// buttons
$("toggle").onclick = () => { $("list").hidden = !$("list").hidden; };
$("zin").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.4);
$("zout").onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.4);
$("fit").onclick = fit;
$("dl").onclick = download;
document.querySelectorAll("#mode button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
addEventListener("resize", fit);
addEventListener("popstate", () => load(new URLSearchParams(location.search).get("map")));

fetch("maps.json").then(r => r.json()).then(conf => {
  buildList(conf.maps);
  load(params.get("map") || conf.main);
});
