# StarHorizon Render

Статический сайт-каталог шаттлов и POI [StarHorizon](https://github.com/StarHorizon14/StarHorizon):
данные, рендеры и миникарты собираются из репозитория игры.

## Структура

| Путь | Назначение |
| --- | --- |
| `index.html`, `app.js`, `style.css` | Каталог. Читает `shuttles.json`. |
| `viewer/` | Просмотрщик изображений. Список карт в `viewer/maps.json` (в репозитории пустой, заполняется при сборке). |
| `game.*`, `tile.*`, `mines.*` | Мини-игры. Читают `shuttles.json` и изображения из `shuttles/`. |
| `scripts/` | Скрипты сборки данных и рендеров. |
| `.github/workflows/` | `render.yml` (рендеры) и `pages.yml` (сайт). |

Генерируемые файлы (`shuttles.json`, `shuttles/`, `render-cache/`) в git не хранятся.

## Данные и скрипты

| Скрипт | Что делает |
| --- | --- |
| `build_shuttles.py <StarHorizon> [out]` | Читает прототипы `vessel` (с наследованием `parent`) и `pointOfInterest`, названия POI берёт из ftl (`poi-*`). Пишет `shuttles.json`, у каждой карты считает `mapSha` (sha1 файла). |
| `render_shuttles.py <StarHorizon> <cache> [out]` | Рендерит карты `Content.MapRenderer` в `<cache>/<mapSha>.webp`. Рендерит только отсутствующие; упавшие в пачке карты повторяет по одной. |
| `attach_renders.py <cache> [out]` | Копирует рендеры в `shuttles/img/` и записывает путь в `shuttles.json`. |
| `render_minimaps.py <StarHorizon> <map-render> [out]` | Миникарты через [starhorizon-map-render](https://github.com/lAstronautl/starhorizon-map-render) в `shuttles/mini/`. |
| `viewer_shuttles.py <site>` | Заполняет `viewer/maps.json`. Ключи: `ship-<id>`, `poi-<id>`. |
| `export_renders.py <cache> <out> [--only ...] [--minimaps .]` | Экспорт в zip или папку под читаемыми именами (`Рендер/`, `Миникарта/`, POI в `POI/`). |

Переменные `render_shuttles.py`: `RENDER_ONLY` (id или названия через запятую), `RENDER_FORCE=true` (перерисовать), `RENDER_BATCH` (размер пачки, по умолчанию 10), `RENDER_LIMIT` (ограничение для проверки).

URL-параметры: каталог `?kind=poi`; просмотрщик `viewer/?map=<ship|poi>-<id>&view=render|mini`.

## Локальный запуск

Нужны .NET 9 SDK, Node 20, Python 3, `pyyaml`.

```
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/StarHorizon14/StarHorizon.git ../StarHorizon
(cd ../StarHorizon && dotnet build Content.MapRenderer -c Release)
git clone --depth 1 https://github.com/lAstronautl/starhorizon-map-render.git ../starhorizon-map-render
(cd ../starhorizon-map-render && npm ci && npm run build --workspace=renderer)

python scripts/build_shuttles.py ../StarHorizon .
python scripts/render_shuttles.py ../StarHorizon render-cache .
python scripts/attach_renders.py render-cache .
python scripts/render_minimaps.py ../StarHorizon ../starhorizon-map-render .
python scripts/viewer_shuttles.py .
python -m http.server
```

## GitHub Actions

- **Render shuttles** (`render.yml`): собирает `Content.MapRenderer`, рендерит карты с кэшем по `mapSha`, выкладывает артефакты `shuttle-renders` (кэш для сайта) и `shuttle-renders-named` (под читаемыми именами). Запуск: расписание (пн и пт, 04:00 UTC) и вручную. Входные параметры вручную: `ships` (какие карты рендерить), `force`. Первый запуск долгий.
- **Build & deploy site** (`pages.yml`): собирает `shuttles.json`, берёт рендеры из последнего успешного Render shuttles, делает миникарты, публикует на GitHub Pages. Запуск: push в `master`/`main`, после успешного Render shuttles, вручную. Рендеры здесь не выполняются.

Один раз включить Pages: **Settings → Pages → Source: GitHub Actions**. До первого успешного Render shuttles на сайте будут только миникарты.
