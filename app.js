const $ = id => document.getElementById(id);
let all = [];
const fmt = n => n.toLocaleString("ru-RU") + " $";

function fill(sel, values) {
  [...new Set(values)].filter(Boolean).sort().forEach(v => {
    const o = document.createElement("option");
    o.value = o.textContent = v;
    $(sel).appendChild(o);
  });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function card(s) {
  const c = el("article", "card");
  const img = el("div", "img");
  const views = [["Рендер", s.image, ""], ["Миникарта", s.minimap, "mini"]].filter(v => v[1]);
  const show = v => {
    img.replaceChildren();
    const i = el("img", v[2]);
    i.src = v[1]; i.alt = s.name; i.loading = "lazy";
    img.appendChild(i);
    if (views.length > 1) {
      const sw = el("div", "views");
      views.forEach(w => {
        const btn = el("button", w === v ? "on" : "", w[0]);
        btn.onclick = () => show(w);
        sw.appendChild(btn);
      });
      img.appendChild(sw);
    }
  };
  if (views.length) show(views[0]); else img.textContent = "нет рендера";
  const b = el("div", "body");
  const top = el("div", "top");
  top.append(el("span", "name", s.name), el("span", "price", fmt(s.price)));
  const tags = el("div", "tags");
  [s.category, s.group, ...s.class].filter(Boolean).forEach(t => tags.appendChild(el("span", "tag", t)));
  s.engine.forEach(t => tags.appendChild(el("span", "tag fuel", "Топливо: " + t)));
  b.append(top, el("div", "desc", s.description), tags);
  c.append(img, b);
  return c;
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const g = $("group").value, cat = $("category").value, cl = $("cls").value, en = $("engine").value;
  let list = all.filter(s =>
    (!q || (s.name + " " + s.description).toLowerCase().includes(q)) &&
    (!g || s.group === g) && (!cat || s.category === cat) &&
    (!cl || s.class.includes(cl)) && (!en || s.engine.includes(en)));
  const sort = $("sort").value;
  list.sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name)
    : sort === "price-desc" ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
  $("grid").replaceChildren(...list.map(card));
  $("count").textContent = `(${list.length}/${all.length})`;
}

fetch("shuttles.json").then(r => r.json()).then(d => {
  all = d.shuttles;
  $("updated").textContent = d.generated || "—";
  fill("group", all.map(s => s.group));
  fill("category", all.map(s => s.category));
  fill("cls", all.flatMap(s => s.class));
  fill("engine", all.flatMap(s => s.engine));
  ["q", "group", "category", "cls", "engine", "sort"].forEach(id => $(id).addEventListener("input", render));
  render();
});
