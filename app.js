const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("ru-RU") + " $";
let all = [];
let mode = "render"; // "render" | "mini"; shared with the viewer through localStorage

try { mode = localStorage.getItem("mode") === "mini" ? "mini" : "render"; } catch (e) { /* storage may be blocked */ }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// multi-select dropdown (details + checkboxes): selected values match as "any of"
const multi = { cls: new Set(), engine: new Set() };

function fillMulti(id, anyLabel, values) {
  const box = $(id), opts = box.querySelector(".opts"), sum = box.querySelector("summary");
  [...new Set(values)].filter(Boolean).sort().forEach(v => {
    const l = el("label", "opt");
    const c = el("input");
    c.type = "checkbox";
    c.onchange = () => {
      c.checked ? multi[id].add(v) : multi[id].delete(v);
      sum.textContent = multi[id].size ? [...multi[id]].sort().join(", ") : anyLabel;
      render();
    };
    l.append(c, document.createTextNode(" " + v));
    opts.appendChild(l);
  });
}

document.addEventListener("click", e => {
  document.querySelectorAll("details.multi[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
});

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
  body.append(top, el("div", "desc", s.descriptionRu || s.description), tags);
  c.append(img, body);
  return c;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const pmin = parseInt($("pmin").value, 10), pmax = parseInt($("pmax").value, 10);
  const g = $("group").value, cat = $("category").value, withCustom = $("custom").checked;
  const list = all.filter(s =>
    (!q || (s.name + " " + s.description + " " + (s.descriptionRu || "")).toLowerCase().includes(q)) &&
    (isNaN(pmin) || s.price >= pmin) && (isNaN(pmax) || s.price <= pmax) &&
    (!g || s.group === g) && (!cat || s.category === cat) &&
    (withCustom || s.group !== "Custom") &&
    (!multi.cls.size || s.class.some(x => multi.cls.has(x))) &&
    (!multi.engine.size || s.engine.some(x => multi.engine.has(x))));
  const sort = $("sort").value;
  list.sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name)
    : sort === "price-desc" ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
  $("grid").replaceChildren(...list.map(card));
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
  fillMulti("cls", "Любой класс", all.flatMap(s => s.class));
  fillMulti("engine", "Любой двигатель", all.flatMap(s => s.engine));
  ["q", "group", "category", "custom", "pmin", "pmax", "sort"].forEach(id => $(id).addEventListener("input", render));
  setMode(mode);
});
