const $ = id => document.getElementById(id);
let all = [];
let shown = [];
const selected = new Set();
const viewerUrl = s => `viewer/?map=ship-${encodeURIComponent(s.id)}`;
const fname = s => s.name.replace(/[<>:"/\\|?*]/g, "_");
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
  const c = el("article", "card" + (selected.has(s.id) ? " sel" : ""));
  const pick = el("input", "pick");
  pick.type = "checkbox"; pick.checked = selected.has(s.id); pick.title = "Выбрать для zip";
  pick.onchange = () => {
    pick.checked ? selected.add(s.id) : selected.delete(s.id);
    c.classList.toggle("sel", pick.checked);
    updateDl();
  };
  c.appendChild(pick);
  const img = el("div", "img");
  img.onclick = e => { if (e.target.tagName !== "BUTTON") openView(s); };
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
  if (s.image) {
    const dl = el("a", "dl", "Скачать");
    dl.href = s.image; dl.download = fname(s) + ".webp";
    const vw = el("a", "dl", "Открыть в просмотрщике");
    vw.href = viewerUrl(s); vw.target = "_blank";
    const links = el("div", "links");
    links.append(vw, dl);
    b.appendChild(links);
  }
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
  shown = list;
  $("grid").replaceChildren(...list.map(card));
  $("count").textContent = `(${list.length}/${all.length})`;
}

function updateDl() {
  $("dl").textContent = selected.size ? `Скачать выбранные (${selected.size})` : "Скачать zip";
  $("clear").hidden = !selected.size;
}

function openView(s) {
  const box = $("view");
  const views = [["Рендер", s.image], ["Миникарта", s.minimap]].filter(v => v[1]);
  if (!views.length) return;
  const show = v => {
    const bar = el("div", "vbar");
    bar.append(el("strong", null, s.name), el("span", "price", fmt(s.price)));
    views.forEach(w => {
      const btn = el("button", w === v ? "on" : "", w[0]);
      btn.onclick = e => { e.stopPropagation(); show(w); };
      bar.appendChild(btn);
    });
    const open = el("a", "dl", "Открыть в просмотрщике");
    open.href = viewerUrl(s); open.target = "_blank";
    open.onclick = e => e.stopPropagation();
    bar.appendChild(open);
    const dl = el("a", "dl", "Скачать");
    dl.href = v[1]; dl.download = fname(s) + (v[1].endsWith(".png") ? " (mini).png" : ".webp");
    dl.onclick = e => e.stopPropagation();
    bar.appendChild(dl);
    const i = el("img", v[1].endsWith(".png") ? "mini" : "");
    i.src = v[1]; i.alt = s.name;
    i.onclick = e => e.stopPropagation();
    box.replaceChildren(bar, i);
  };
  show(views[0]);
  box.hidden = false;
}
$("view").onclick = () => { $("view").hidden = true; };
document.addEventListener("keydown", e => { if (e.key === "Escape") $("view").hidden = true; });

async function downloadZip() {
  const items = (selected.size ? all.filter(s => selected.has(s.id)) : shown).filter(s => s.image);
  if (!items.length) return alert("Среди найденных шаттлов нет готовых рендеров");
  const btn = $("dl");
  btn.disabled = true;
  try {
    const zip = new JSZip();
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      btn.textContent = `Готовлю ${i + 1}/${items.length}`;
      let name = fname(items[i]);
      if (used.has(name.toLowerCase())) name += ` [${items[i].id}]`;
      used.add(name.toLowerCase());
      zip.file(name + ".webp", await (await fetch(items[i].image)).blob());
    }
    const url = URL.createObjectURL(await zip.generateAsync({ type: "blob", compression: "STORE" }));
    const a = el("a");
    a.href = url; a.download = items.length === 1 ? fname(items[0]) + ".zip" : "shuttle-renders.zip";
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    updateDl();
  }
}
$("dl").addEventListener("click", downloadZip);
$("clear").addEventListener("click", () => { selected.clear(); updateDl(); render(); });

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
