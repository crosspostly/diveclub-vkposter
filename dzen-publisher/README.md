# 📰 Dzen Auto-Publisher (`dzen-publisher`)

Публикация в **Яндекс Дзен** через Playwright — **без API, без логина и пароля**
(только куки реальной сессии). Два независимых пайплайна:

| Что | Скрипт | Статус |
|---|---|---|
| 📄 **Статьи** (заголовок → текст → картинка → публикация) | `publish-dzen.js` | ✅ проверено живой публикацией 2026-08-16 |
| 🎬 **Видео** (загрузка файла → модалка → публикация) | `publish-dzen-video.js` | ✅ проверено живой публикацией 2026-08-16 |

Работает с любым каналом Дзена, где вы автор — задаётся слагом канала (см. «Настройка»).

---

## 📁 Что в каталоге

```
dzen-publisher/
├── package.json          # commonjs; зависимости: playwright, dotenv
├── playwrightService.js  # весь браузерный цикл: куки, редактор, статья, видео, капча
├── publish-dzen.js       # оркестратор статей (feed.xml → публикация → история)
├── publish-dzen-video.js # оркестратор видео (локальный файл → модалка → публикация)
├── probe-editor.js       # исследование DOM редактора (поиск селекторов), read-only
├── .env.example          # шаблон переменных окружения (→ скопируйте в .env)
├── .gitignore            # секреты и мусор не коммитятся
├── config/               # сюда кладётся cookies.json (НЕ коммитится)
├── history/              # файлы истории публикаций (НЕ коммитятся)
└── README.md             # этот файл
```

---

## ⚡ Быстрый старт (3 шага)

```bash
# 1. Установка зависимостей (один раз)
cd dzen-publisher
npm install
npx playwright install chromium        # браузеры для Playwright

# 2. Куки + канал (см. «Куки» и «Настройка»):
#    - положить экспорт EditThisCookie в config/cookies.json  (или в .env DZEN_COOKIES_JSON)
#    - при необходимости указать свой канал в .env: DZEN_CHANNEL_SLUG

# 3. Сухой прогон — проверить, что всё живое:
node publish-dzen.js --dry-run --keep-open 10
```

**Правило №1:** перед любой реальной публикацией — сначала `--dry-run`. Публикация
необратима и видна всем подписчикам канала.

---

## 📋 Требования

- **Node.js 18+** (проверено на 24)
- **Playwright** + браузер **Chromium** (ставятся через `npm install` + `npx playwright install chromium`)
- **Куки авторизованной сессии** Дзена (см. ниже)
- **ffmpeg** (опционально) — только чтобы сгенерировать тестовое видео для проверки

---

## 🍪 Куки (единственный «логин»)

Скрипты не вводят логин/пароль — они открывают браузер с куками вашей сессии.

Куки задаются **одним из двух способов** (приоритет — файл):

1. Файл `config/cookies.json` — экспорт расширения **EditThisCookie** (Chrome/Яндекс.Браузер):

   ```json
   [
     { "name": "sessionid", "value": "...", "domain": ".dzen.ru", "path": "/",
       "expirationDate": 1750000000, "httpOnly": true, "secure": true, "sameSite": "no_restriction" },
     ...
   ]
   ```

2. Переменная `DZEN_COOKIES_JSON` в `.env` — то же содержимое JSON одной строкой.

Как получить/обновить (куки живут ~неделю-месяц; при ошибке «Redirected to login page» — обновить):

1. Откройте `https://dzen.ru` в браузере, убедитесь, что вы залогинены в нужный канал.
2. Установите расширение **EditThisCookie**.
3. На странице `dzen.ru` → иконка расширения → **Export**.
4. Сохраните JSON как `dzen-publisher/config/cookies.json` (или в `DZEN_COOKIES_JSON`).

> ⚠️ **Куки = полный доступ к каналу.** Это секрет! Файлы `.env` и `config/cookies.json`
> не коммитятся (см. `.gitignore`). Не публикуйте их в git ни в каком виде.

---

## ⚙️ Настройка (свой канал)

Слаг канала — часть адреса студии: `dzen.ru/profile/editor/<слаг>`.
Задаётся в `.env`:

```bash
DZEN_CHANNEL_SLUG=мой-слаг
```

(по умолчанию в коде — `your-channel-slug`; без него скрипт не найдёт студию — укажите свой).

Остальные настройки — в `.env` (см. `.env.example`):

| Переменная | Что делает | По умолчанию |
|---|---|---|
| `DZEN_CHANNEL_SLUG` | канал публикации | `your-channel-slug` |
| `DZEN_COOKIES_JSON` | куки (альтернатива файлу) | — |
| `DZEN_FEED_PATH` | путь к feed.xml для статей | `./feed.xml` |
| `HEADLESS` | `true` — без окна браузера | `true` |

Таймауты и остальные константы — в `playwrightService.js` (ожидание обработки видео 180 с,
закрытие модалки 45 с, редирект статьи 45 с).

---

## 📄 Запуск: статьи (`publish-dzen.js`)

```bash
# Реальная публикация первой неопубликованной статьи из feed.xml (см. ниже)
node publish-dzen.js

# DRY-RUN: полный цикл, но без нажатия «Опубликовать»
node publish-dzen.js --dry-run --keep-open 10

# Тест с данными из CLI (feed.xml не нужен)
node publish-dzen.js --dry-run --title "Заголовок" --text "Текст" --image "https://.../img.jpg"

# Без окна браузера
$env:HEADLESS="true"; node publish-dzen.js --dry-run
```

### Флаги

| Флаг | Описание |
|---|---|
| `--dry-run` | весь цикл (логин, статья, картинка), но НЕ «Опубликовать» |
| `--keep-open N` | держать браузер N секунд после завершения |
| `--title / --text / --image` | тестовая статья из CLI вместо feed.xml |
| `--article N` | взять N-ю статью из feed.xml (индекс с 0) |
| `HEADLESS` | без окна браузера (CI) |

### Откуда берутся статьи

Из `feed.xml` в этом каталоге (путь можно поменять через `DZEN_FEED_PATH`). Формат — стандартный
RSS: `<item>` с `<title>`, `<link>`, `<media:content url="...">` (картинка) и текстом
в `<content:encoded>` / `<description>` (HTML → текст).

Пропускаются статьи, уже записанные в `history/published_articles.txt` — повторные запуски
не дают дублей. Для разовой проверки проще `--title/--text/--image`.

---

## 🎬 Запуск: видео (`publish-dzen-video.js`)

```bash
# Сухой прогон: полный цикл + заполнение модалки, без «Опубликовать»
node publish-dzen-video.js --dry-run --keep-open 10 ^
  --video "C:\path\to\video.mp4" ^
  --title "Заголовок" ^
  --text "Описание (необязательно)" ^
  --tags "тег1,тег2" ^
  --cover "C:\path\to\cover.jpg"

# Живая публикация (сначала — dry-run и подтверждение!)
node publish-dzen-video.js --video "C:\path\to\video.mp4" --title "Заголовок" --text "..." --tags "тег1"
```

### Флаги

| Флаг | Описание |
|---|---|
| `--video <path>` | **обязательно** — путь к локальному видео (mp4/webm/mov/avi/mkv…) |
| `--title <text>` | **обязательно** — название (без него Дзен не публикует) |
| `--text <text>` | описание (необязательно) |
| `--tags "a,b"` | теги через запятую (каждый подтверждается Enter) |
| `--cover <path>` | локальная обложка jpg/png; без неё — авто-кадр из видео |
| `--comments all\|subs\|none` | кто комментирует: `all` = «Все пользователи» (по умолчанию), `none` = «Никто», иное = не трогать (останется «Подписчики») |
| `--dry-run` | весь цикл, НЕ нажимать «Опубликовать» |
| `--keep-open N` | держать браузер N секунд |

Тестовое видео, если нет под рукой (ffmpeg):

```bash
ffmpeg -y -f lavfi -i "testsrc=duration=5:size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:duration=5" ^
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest test-video.mp4
```

История видео: `history/published_videos.txt`.

---

## ⚙️ Как это работает: статьи

```
1. initBrowser   — Chromium 1920×1080, UA Яндекс.Браузера,
                   permissions: ['clipboard-read','clipboard-write'] ← критично для вставки текста
2. loadCookies   — куки из config/cookies.json или .env; нормализация sameSite
3. navigateToEditor
   ├─ goto dzen.ru/profile/editor/<слаг>
   ├─ если passport.yandex → «куки протухли», стоп
   ├─ закрыть стартовую модалку ([data-testid="close-button"] / [aria-label="Закрыть"])
   ├─ клик «Добавить публикацию» ([data-testid="add-publication-button"])
   └─ клик «Написать статью» (text="Написать статью")
       (fallback: прямой goto /profile/editor/new/article)
4. fillArticle
   ├─ найти поля: input[type="text"], textarea, div[contenteditable="true"]
   │   → [0] = заголовок, [1] = текст (по индексу!)
   ├─ заголовок: focus → click → Ctrl+A → Backspace → type(заголовок, delay:50)
   │   ← ЗАГОЛОВОК ПЕЧАТАЕТСЯ, а не вставляется буфером (проверено: paste ломает цикл)
   ├─ текст: focus → click → clipboard.writeText → Ctrl+V → Enter
   └─ картинка (если есть URL):
       ├─ кнопка button[data-tip="Вставить изображение"] (перебор 4 селекторов)
       ├─ модалка: input[type="text"][placeholder*="ссылка"] → fill(URL) → Enter → ждём 3 с
5. submitPublish
   ├─ button[data-testid="article-publish-btn"] (не disabled) → click
   ├─ капча (#not-robot-captcha-checkbox, все фреймы) → клик по label
   ├─ button[data-testid="publish-btn"][type="submit"] → click
   ├─ капча (до 15 попыток)
   └─ валидация: URL ушёл из /editor/ (до 45 с) → success + url
```

Отладочные артефакты (в этом каталоге): `step1_editor.png/html`, `step2_menu_open.*`,
`step3_editor_loaded.*`, dry-run — `00-dry-final.*`, ошибка — `error_state.*`.

---

## 🎬 Как это работает: видео

```
1-3. те же, что у статьи (куки → редактор → «Добавить публикацию»)
4. navigateToVideoUpload
   └─ клик label[role="button"][aria-label="Загрузить видео"] (пункт меню)
5. selectVideoFile
   ├─ кнопка «Выбрать видео» (button:has-text("Выбрать видео"))
   └─ filechooser.setFiles(локальный файл)  — без нативного диалога
6. waitForVideoReady — ждём загрузку и обработку (до 180 с):
   ├─ button[data-testid="publish-btn"] появилась (модалка открыта)
   └─ …и она :not([disabled]) («Готово: можно публиковать и смотреть»)
7. fillVideoModal
   ├─ название: textarea.Textarea-Control.Texteditor-Control_withSizing
   │   ← предзаполнено из имени файла → Ctrl+A → Backspace → type(delay:50)
   ├─ описание: .ql-editor → clipboard.writeText → Ctrl+V
   ├─ теги: input.video-editor--tag-input__input-29 → type + Enter на каждый
   ├─ комментарии: [data-testid="select-trigger-button-comment"] →
   │               label[data-testid="Все пользователи"] (или «Никто», по --comments)
   └─ обложка: input[type="file"][accept*="image"] → setInputFiles (если --cover)
8. submitVideoPublish
   ├─ button[data-testid="publish-btn"][type="submit"]:not([disabled]) → click
   ├─ капча (до 10 попыток, все фреймы)
   ├─ валидация: кнопка исчезла из DOM = модалка закрылась (до 45 с)
   └─ URL: редирект на /video/watch/... (иначе — первая ссылка /video/watch/ на канале)
```

Отладочные артефакты: `v1_menu_open.*`, `v2_video_page.*`, `v3_upload_started.*`,
`v4_modal_ready.*`, dry-run — `00-video-dry-final.*`, ошибка — `video_error_state.*`.

**Нюанс:** после «Опубликовать» Дзен обрабатывает видео в фоне — URL приходит по редиректу
сразу, но на канале ролик может появиться с задержкой.

---

## 🔎 Селекторы: статьи (полный список)

| Что | Селектор | Примечание |
|---|---|---|
| Стартовая модалка | `[data-testid="close-button"], [aria-label="Закрыть"]` | закрывается, если есть |
| «Добавить публикацию» | `[data-testid="add-publication-button"]` | + 3 fallback |
| «Написать статью» (меню) | `text="Написать статью"` | + 3 fallback |
| Поля редактора | `input[type="text"], textarea, div[contenteditable="true"]` | **по индексу: [0]=заголовок, [1]=текст** |
| Кнопка картинки | `button[data-tip="Вставить изображение"]` | видна сразу, hover не нужен; + 3 fallback |
| Поле URL картинки | `input[type="text"][placeholder*="ссылка"]` | fallback: любой `input[type="text"]` |
| «Опубликовать» (редактор) | `button[data-testid="article-publish-btn"]` | ждём `:not([disabled])` |
| «Опубликовать» (модалка) | `button[data-testid="publish-btn"][type="submit"]` | — |
| Капча | `#not-robot-captcha-checkbox` | ищется во всех фреймах |

**Важно про поля редактора:** заголовок и текст — `div[contenteditable]` без стабильных
классов. Рабочая версия берёт их **по порядку в DOM** (`$$[0]`, `$$[1]`). Классы вида
`.article-editor-desktop--editable-input` уже не существуют (проверено 2026-08) — не пытайтесь
«улучшить» на них.

**Важно про картинки:** сервер Дзена скачивает картинку сам — URL должен быть доступен из РФ.
`picsum.photos` (fastly CDN) → «Не удалось загрузить изображение». Рабочие:
`raw.githubusercontent.com/...`, картинки вашего сайта.

---

## 🎬 Селекторы: видео (полный список)

| Что | Селектор |
|---|---|
| «Загрузить видео» (меню) | `label[role="button"][aria-label="Загрузить видео"]` |
| «Выбрать видео» | `button:has-text("Выбрать видео")` |
| Название | `textarea.Textarea-Control.Texteditor-Control_withSizing` (fallback: `$$('textarea.Textarea-Control.Texteditor-Control')[1]`) |
| Описание | `.video-editor--quill-text-field__editorContainer-mB .ql-editor` |
| Теги | `input.video-editor--tag-input__input-29` (fallback: `input[placeholder="Добавьте теги"]`) |
| Комментарии: триггер | `[data-testid="select-trigger-button-comment"]` |
| Комментарии: опции | `label[data-testid="Все пользователи"]` / `label[data-testid="Никто"]` / `label[data-testid="Подписчики"]` |
| Обложка (файл) | `input[type="file"][accept*="image"]` |
| «Опубликовать» | `button[data-testid="publish-btn"][type="submit"]` |
| Признак готовности | «Загрузили и обработали видео» / «Готово: можно публиковать и смотреть» |

**Нюансы:** название в модалке предзаполняется из имени файла — скрипт очищает (Ctrl+A) и
печатает (`type`), не вставляет буфером. Кастомная обложка через `setInputFiles` заменяет пункт
«Добавить обложку» (он исчезает из списка кадров).

---

## 🛠 Где искать селекторы, если Дзен что-то поменял

Дзен обновляет вёрстку периодически — хэшированные классы (`video-editor--tag-input__input-29`,
`.article-editor-desktop--side-button__sideButton-1z`) меняются при каждом релизе, а
`data-testid` / `data-tip` / `aria-label` / `placeholder` живут дольше. Порядок действий:

### 1. Смотрите HTML-дампы (самый быстрый путь)

Каждый запуск пишет в этот каталог полный HTML + скриншот каждого шага:
`step1_editor.html`, `v1_menu_open.html`, `v4_modal_ready.html` и т.д. (см. флоу выше).

1. Запустите `--dry-run --keep-open 15`, чтобы пройти ровно до проблемного шага.
2. Откройте нужный `.html` в браузере.
3. Найдите элемент (кнопку, поле, пункт меню) — скопируйте его `data-testid`, `data-tip`,
   `aria-label`, `placeholder` или класс.
4. Вставьте новый селектор в `playwrightService.js` на место старого.

### 2. `probe-editor.js` — живой осмотр редактора

Скрипт открывает **видимое** окно браузера, проходит: меню «Добавить публикацию» → «Написать
статью», и печатает в консоль все видимые кнопки и поля с их атрибутами:

```bash
node probe-editor.js
```

Read-only: ничего не заполняет и не публикует. Открывает только **редактор статей**;
для видео-модалки используйте дампы `v*.html` или сниппет из п.3.

### 3. Сниппет для консоли DevTools

На нужной странице (меню, редактор, модалка) откройте DevTools → Console и выполните:

```js
// Все кликабельные элементы с подписями
[...document.querySelectorAll('button, label, [role="button"]')].map(b =>
  `${b.tagName}[data-testid="${b.dataset.testid||''}"] tip="${b.dataset.tip||''}" aria="${b.getAttribute('aria-label')||''}" text="${(b.innerText||'').trim().slice(0,40)}"`).join('\n')
```

```js
// Все поля ввода
[...document.querySelectorAll('input, textarea, [contenteditable="true"]')].map(el =>
  `<${el.tagName} type="${el.type||''}" placeholder="${el.getAttribute('placeholder')||''}" cls="${(el.className||'').toString().slice(0,60)}"`).join('\n')
```

### 4. Где селекторы лежат в коде

- **Статьи:** `playwrightService.js` → `fillArticle()` (поля, картинка) и `submitPublish()` (кнопки, капча).
- **Видео:** `playwrightService.js` → `navigateToVideoUpload()`, `selectVideoFile()`,
  `fillVideoModal()`, `submitVideoPublish()`.
- `probe-editor.js` → `EDITOR_URL` (свой канал).

### 5. Правила выбора селекторов

1. Сначала `data-testid` / `data-tip` / `aria-label` — они стабильнее классов.
2. Классы — только как fallback, и лучше без хэша: `input.video-editor--tag-input__input` без `-29`.
3. Текстовые селекторы (`text="Написать статью"`, `button:has-text("Выбрать видео")`) — надёжны
   для пунктов меню, но могут зацепить лишнее — уточняйте тегом/ролью.
4. После правки селектора всегда проверяйте `--dry-run` (скриншоты покажут, что нашли верный элемент).

---

## 🐞 Частые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| «Redirected to login page» | куки протухли | обновить `config/cookies.json` (см. «Куки») |
| «No inputs found in editor» | Дзен поменял редактор | `probe-editor.js` → новый селектор полей |
| «Написать статью / Загрузить видео not found» | изменилось меню | дамп `step2_menu_open.html` / `v_dump_menu.html` |
| «Не удалось загрузить изображение» | URL недоступен из РФ | использовать `raw.githubusercontent.com` или свой сайт |
| Кнопка «Опубликовать» долго не активна | видео ещё обрабатывается | ждать (таймаут 180 с); для больших файлов — дольше |
| Клик по элементу падает (timeout) | Дзен перерисовывает DOM | порядок в скрипте уже учитывает; см. `error_state.*` дамп |
| Капча не кликается | iframe | скрипт ищет по всем фреймам; при повторе — обновить куки |
| `Cannot find module 'playwright'` | не установлены зависимости | `npm install` в `dzen-publisher/` |

---

## 🔒 Безопасность

- `config/cookies.json` и `.env` — **секрет** (полный доступ к каналу). Они в `.gitignore` —
  не коммитьте их вручную.
- Публикация — необратимое внешнее действие. Всегда сначала `--dry-run`.
- Скрипт не логирует и не отправляет куда-либо данные; всё работает локально.

---

## 🗄 История публикаций

| Файл | Формат строки |
|---|---|
| `history/published_articles.txt` | `2026-08-16 06:50:24 - Заголовок - https://dzen.ru/a/...` |
| `history/published_videos.txt` | `2026-08-16 07:17:40 - Заголовок - https://dzen.ru/video/watch/...` |

Статьи-пайплайн пропускает уже опубликованные (по заголовку) — можно гонять повторно без
дублей. Видео-пайплайн всегда публикует переданный файл (история — только для учёта).
