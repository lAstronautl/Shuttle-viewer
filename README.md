# Shuttle Viewer

Статичный каталог шаттлов [StarHorizon](https://github.com/StarHorizon14/StarHorizon):
цена, размер, класс, топливо/двигатель, спецификации и схема корабля.

## Как это работает
1. `scripts/build_shuttles.py` читает `vessel`-прототипы StarHorizon (с наследованием от `parent`)
   и пишет `shuttles.json`: название, цена, размер, магазин, класс, двигатель/топливо, описание.
2. `scripts/render_shuttles.py` рендерит карту каждого шаттла (`shuttlePath`) оригинальным
   `Content.MapRenderer` из StarHorizon (тот же рендер, что в игре) и кладёт картинки в `shuttles/img/`.
   Рендеры кэшируются по sha1 файла карты: перерисовываются только новые/изменённые шаттлы.
3. `scripts/render_minimaps.py` рисует миникарты (1 пиксель = 1 тайл, как в гайдбуке) через
   [starhorizon-map-render](https://github.com/lAstronautl/starhorizon-map-render) и кладёт их в `shuttles/mini/`.
   В карточке можно переключаться между полным рендером и миникартой.
4. `index.html` + `app.js` показывают карточки с поиском и фильтрами.

## Локально
Нужны .NET 9 SDK, Node 20, Python 3 и `pyyaml`.
```
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/StarHorizon14/StarHorizon.git ../StarHorizon
(cd ../StarHorizon && dotnet build Content.MapRenderer -c Release)
python scripts/build_shuttles.py ../StarHorizon .
python scripts/render_shuttles.py ../StarHorizon render-cache .   # ~40 c на шаттл, первый запуск долгий
git clone --depth 1 https://github.com/lAstronautl/starhorizon-map-render.git ../starhorizon-map-render
(cd ../starhorizon-map-render && npm ci && npm run build --workspace=renderer)
python scripts/render_minimaps.py ../StarHorizon ../starhorizon-map-render .
python -m http.server
```
`RENDER_LIMIT=N` ограничивает число шаттлов для быстрой проверки.

## GitHub Pages
Workflow `.github/workflows/pages.yml` два раза в неделю (понедельник и пятница, 04:00 UTC) и вручную (Actions → Run workflow); по push не запускается,
собирает MapRenderer, генерирует данные, рендерит шаттлы (с кэшем) и публикует сайт.
Первый запуск рендерит все ~170 шаттлов и идёт долго (порядка 1,5–2 часов), дальше — минуты.
Включить один раз: **Settings → Pages → Source: GitHub Actions**.
