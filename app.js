const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("ru-RU") + " $";
const fname = s => s.name.replace(/[<>:"/\\|?*]/g, "_");
let all = [];
let mode = "render"; // "render" | "mini"; shared with the viewer through localStorage

try { mode = localStorage.getItem("mode") === "mini" ? "mini" : "render"; } catch (e) { /* storage may be blocked */ }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fill(sel, values) {
  [...new Set(values)].filter(Boolean).sort().forEach(v => {
    const o = el("option", "", v);
    o.value = v;
    $(sel).appendChild(o);
  });
}

// the picture shown in the current mode; falls back to the other one when it doesn't exist
function pick(s) {
  const [first, second] = mode === "mini" ? [s.minimap, s.image] : [s.image, s.minimap];
  return first || second || null;
}

function viewerUrl(s) {
  return `viewer/?map=ship-${encodeURIComponent(s.id)}&view=${mode}`;
}

function card(s) {
  const c = el("article", "card");
  const open = () => { location.href = viewerUrl(s); };
  c.onclick = open;

  const img = el("div", "img");
  const src = pick(s);
  if (src) {
    const i = el("img", src.endsWith(".png") ? "mini" : "");
    i.src = src; i.alt = s.name; i.loading = "lazy";
    img.appendChild(i);
  } else {
    img.textContent = "нет изображения";
  }

  const top = el("div", "top");
  const name = el("a", "name", s.name);
  name.href = viewerUrl(s);
  name.onclick = e => e.stopPropagation();
  top.append(name, el("span", "price", fmt(s.price)));

  const tags = el("div", "tags");
  [s.category, s.group, ...s.class].filter(Boolean).forEach(t => tags.appendChild(el("span", "tag", t)));
  s.engine.forEach(t => tags.appendChild(el("span", "tag fuel", "Топливо: " + t)));

  const body = el("div", "body");
  body.append(top, el("div", "desc", s.description), tags);
  if (src) {
    const dl = el("a", "dl", "Скачать");
    dl.href = src;
    dl.download = fname(s) + (src.endsWith(".png") ? " (mini).png" : ".webp");
    dl.onclick = e => e.stopPropagation();
    body.appendChild(dl);
  }
  c.append(img, body);
  return c;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const g = $("group").value, cat = $("category").value, cl = $("cls").value, en = $("engine").value;
  const list = all.filter(s =>
    (!q || (s.name + " " + s.description).toLowerCase().includes(q)) &&
    (!g || s.group === g) && (!cat || s.category === cat) &&
    (!cl || s.class.includes(cl)) && (!en || s.engine.includes(en)));
  const sort = $("sort").value;
  list.sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name)
    : sort === "price-desc" ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
  $("grid").replaceChildren(...list.map(card));
  $("count").textContent = `(${list.length}/${all.length})`;
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("mode", m); } catch (e) { /* ignore */ }
  document.querySelectorAll("#mode button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  render();
}

document.querySelectorAll("#mode button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

fetch("shuttles.json").then(r => r.json()).then(d => {
  all = d.shuttles;
  $("updated").textContent = d.generated || "-";
  fill("group", all.map(s => s.group));
  fill("category", all.map(s => s.category));
  fill("cls", all.flatMap(s => s.class));
  fill("engine", all.flatMap(s => s.engine));
  ["q", "group", "category", "cls", "engine", "sort"].forEach(id => $(id).addEventListener("input", render));
  setMode(mode);
});
