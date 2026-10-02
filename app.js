const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("ru-RU") + " $";
let all = [];
let pois = [];
let kind = "ship"; // "ship" | "poi"
let mode = "render"; // "render" | "mini"; shared with the viewer through localStorage

try {
  mode = localStorage.getItem("mode") === "mini" ? "mini" : "render";
  kind = localStorage.getItem("kind") === "poi" ? "poi" : "ship";
} catch (e) { /* storage may be blocked */ }
{ // ?kind=poi|ship in the link overrides the remembered choice
  const k = new URLSearchParams(location.search).get("kind");
  if (k === "poi" || k === "ship") kind = k;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Multi-select dropdowns (details + checkboxes).
//  cls / engine: a shuttle must have ALL the checked values (AME + APU = both engines); nothing checked = no filter.
//  category (size): a shuttle has exactly one size, so any of the checked sizes matches; nothing checked = no filter.
//  The captions stay fixed (Верфи, Размер, Класс, Генератор, Цена); a highlighted border shows that a filter is active.
//  group (shipyards): all checked by default except HIDDEN_BY_DEFAULT (Custom); toggle a shipyard to show/hide its shuttles.
const multi = { cls: new Set(), engine: new Set(), group: new Set(), category: new Set() };
const HIDDEN_BY_DEFAULT = new Set(["Custom"]);

function fillMulti(id, values, allChecked = false) {
  const box = $(id), opts = box.querySelector(".opts");
  const list = [...new Set(values)].filter(Boolean).sort();
  const mark = () => box.classList.toggle("active", allChecked ? multi[id].size !== list.length : multi[id].size > 0);
  list.forEach(v => {
    const l = el("label", "opt");
    const c = el("input");
    c.type = "checkbox";
    if (allChecked && !HIDDEN_BY_DEFAULT.has(v)) { c.checked = true; multi[id].add(v); }
    c.onchange = () => {
      c.checked ? multi[id].add(v) : multi[id].delete(v);
      mark();
      render();
    };
    l.append(c, document.createTextNode(" " + v));
    opts.appendChild(l);
  });
  mark();
}

// price: dual slider + number fields, from the cheapest to the most expensive shuttle
const price = { min: 0, max: 0, lo: 0, hi: 0, sort: "asc" }; // sort: by price, ascending by default

function setPrice(lo, hi, from) {
  price.lo = Math.max(price.min, Math.min(lo, price.max));
  price.hi = Math.max(price.min, Math.min(hi, price.max));
  if (price.lo > price.hi) from === "hi" ? price.lo = price.hi : price.hi = price.lo;
  $("rlo").value = price.lo; $("rhi").value = price.hi;
  $("pmin").value = price.lo; $("pmax").value = price.hi;
  const full = price.lo === price.min && price.hi === price.max;
  $("price").classList.toggle("active", !full);
  document.querySelectorAll("#price .seg button").forEach(b => b.classList.toggle("on", b.dataset.sort === price.sort));
  render();
}

function initPrice() {
  const prices = all.map(s => s.price);
  price.min = Math.min(...prices);
  price.max = Math.max(...prices);
  for (const id of ["rlo", "rhi"]) {
    $(id).min = price.min; $(id).max = price.max; $(id).step = 250;
  }
  $("pmin").min = $("pmax").min = price.min;
  $("pmin").max = $("pmax").max = price.max;
  $("rlo").oninput = () => setPrice(+$("rlo").value, price.hi, "lo");
  $("rhi").oninput = () => setPrice(price.lo, +$("rhi").value, "hi");
  $("pmin").onchange = () => setPrice(parseInt($("pmin").value, 10) || price.min, price.hi, "lo");
  $("pmax").onchange = () => setPrice(price.lo, parseInt($("pmax").value, 10) || price.max, "hi");
  document.querySelectorAll("#price .seg button").forEach(b => b.onclick = () => { price.sort = b.dataset.sort; setPrice(price.lo, price.hi); });
  $("preset").onclick = () => { price.sort = "asc"; setPrice(price.min, price.max); };
  setPrice(price.min, price.max);
}

document.addEventListener("click", e => {
  document.querySelectorAll("details.multi[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
});

// the picture shown in the current mode; falls back to the other one when it doesn't exist
function pick(s) {
  const [first, second] = mode === "mini" ? [s.minimap, s.image] : [s.image, s.minimap];
  return first || second || null;
}

function viewerUrl(s) {
  return `viewer/?map=${s.kind}-${encodeURIComponent(s.id)}&view=${mode}`;
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
  if (s.kind === "ship") top.append(name, el("span", "price", fmt(s.price)));
  else top.append(name);

  const tags = el("div", "tags");
  const labels = s.kind === "ship" ? [s.category, s.group, ...s.class] : [s.spawnGroup];
  labels.filter(Boolean).forEach(t => tags.appendChild(el("span", "tag", t)));
  (s.engine || []).forEach(t => tags.appendChild(el("span", "tag fuel", t)));

  const body = el("div", "body");
  body.append(top, el("div", "desc", s.description), tags);
  c.append(img, body);
  return c;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  if (kind === "poi") {
    const list = pois.filter(s => !q || s.name.toLowerCase().includes(q));
    list.sort((a, b) => a.name.localeCompare(b.name));
    $("grid").replaceChildren(...list.map(card));
    return;
  }
  const list = all.filter(s =>
    (!q || (s.name + " " + s.description).toLowerCase().includes(q)) &&
    s.price >= price.lo && s.price <= price.hi &&
    multi.group.has(s.group) && (!multi.category.size || multi.category.has(s.category)) &&
    [...multi.cls].every(x => s.class.includes(x)) &&
    [...multi.engine].every(x => s.engine.includes(x)));
  list.sort((a, b) => (price.sort === "desc" ? b.price - a.price : a.price - b.price) || a.name.localeCompare(b.name));
  $("grid").replaceChildren(...list.map(card));
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("mode", m); } catch (e) { /* ignore */ }
  document.querySelectorAll("#mode button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  render();
}

function setKind(k) {
  kind = k;
  try { localStorage.setItem("kind", k); } catch (e) { /* ignore */ }
  document.querySelectorAll("#kind button").forEach(b => b.classList.toggle("on", b.dataset.kind === k));
  $("ship-filters").hidden = k === "poi";
  $("q").placeholder = k === "poi" ? "Поиск по названию..." : "Поиск по названию, описанию...";
  render();
}

document.querySelectorAll("#mode button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("#kind button").forEach(b => b.addEventListener("click", () => setKind(b.dataset.kind)));

fetch("shuttles.json").then(r => r.json()).then(d => {
  all = d.shuttles.map(s => ({ ...s, kind: "ship" }));
  pois = (d.pois || []).map(s => ({ ...s, kind: "poi" }));
  $("updated").textContent = d.generated || "-";
  fillMulti("group", all.map(s => s.group), true);
  fillMulti("category", all.map(s => s.category));
  fillMulti("cls", all.flatMap(s => s.class));
  fillMulti("engine", all.flatMap(s => s.engine));
  $("q").addEventListener("input", render);
  initPrice(); // renders
  setMode(mode);
  setKind(kind);
});
