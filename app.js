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

// Multi-select dropdowns (details + checkboxes).
//  cls / engine: a shuttle must have ALL the checked values (AME + APU = both engines); nothing checked = no filter.
//  group (shipyards): all checked by default except HIDDEN_BY_DEFAULT (Custom); toggle a shipyard to show/hide its shuttles.
const multi = { cls: new Set(), engine: new Set(), group: new Set() };
const HIDDEN_BY_DEFAULT = new Set(["Custom"]);

function fillMulti(id, anyLabel, values, allChecked = false) {
  const box = $(id), opts = box.querySelector(".opts"), sum = box.querySelector("summary");
  const list = [...new Set(values)].filter(Boolean).sort();
  const label = () => {
    const n = multi[id].size;
    if (allChecked) {
      const off = list.filter(v => !multi[id].has(v));
      if (!off.length) return anyLabel;
      if (!n) return "Ничего не выбрано";
      return off.length <= 2 ? `Все, кроме ${off.join(", ")}` : `Верфи: ${[...multi[id]].sort().join(", ")}`;
    }
    return n ? [...multi[id]].sort().join(" + ") : anyLabel;
  };
  list.forEach(v => {
    const l = el("label", "opt");
    const c = el("input");
    c.type = "checkbox";
    if (allChecked && !HIDDEN_BY_DEFAULT.has(v)) { c.checked = true; multi[id].add(v); }
    c.onchange = () => {
      c.checked ? multi[id].add(v) : multi[id].delete(v);
      sum.textContent = label();
      render();
    };
    l.append(c, document.createTextNode(" " + v));
    opts.appendChild(l);
  });
  sum.textContent = label();
}

// price: dual slider + number fields, from the cheapest to the most expensive shuttle
const price = { min: 0, max: 0, lo: 0, hi: 0 };

function setPrice(lo, hi, from) {
  price.lo = Math.max(price.min, Math.min(lo, price.max));
  price.hi = Math.max(price.min, Math.min(hi, price.max));
  if (price.lo > price.hi) from === "hi" ? price.lo = price.hi : price.hi = price.lo;
  $("rlo").value = price.lo; $("rhi").value = price.hi;
  $("pmin").value = price.lo; $("pmax").value = price.hi;
  const full = price.lo === price.min && price.hi === price.max;
  $("price").querySelector("summary").textContent = full ? "Цена" : `Цена: ${price.lo.toLocaleString("ru-RU")} - ${price.hi.toLocaleString("ru-RU")}`;
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
  $("preset").onclick = () => setPrice(price.min, price.max);
  setPrice(price.min, price.max);
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
  const cat = $("category").value;
  const list = all.filter(s =>
    (!q || (s.name + " " + s.description + " " + (s.descriptionRu || "")).toLowerCase().includes(q)) &&
    s.price >= price.lo && s.price <= price.hi &&
    multi.group.has(s.group) && (!cat || s.category === cat) &&
    [...multi.cls].every(x => s.class.includes(x)) &&
    [...multi.engine].every(x => s.engine.includes(x)));
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
  fillMulti("group", "Все верфи", all.map(s => s.group), true);
  fill("category", all.map(s => s.category));
  fillMulti("cls", "Любой класс", all.flatMap(s => s.class));
  fillMulti("engine", "Любой двигатель", all.flatMap(s => s.engine));
  ["q", "category", "sort"].forEach(id => $(id).addEventListener("input", render));
  initPrice(); // renders
  setMode(mode);
});
