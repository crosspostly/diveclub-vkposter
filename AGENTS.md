# AGENTS.md

Отложенный постинг в VK: один вызов скрипта → один пост с `publish_date` на стену сообщества.
Скрипт завершается сразу после `wall.post` — никакого демона, тиков и кнопок.

## Setup commands

- Install deps: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
  (Windows: `.venv\Scripts\pip install -r requirements.txt`)
- Run CLI: `.venv/bin/python post.py "Текст поста" --at 2026-06-15T09:00:00+03:00 --photo img.jpg --video clip.mp4`
  (без `--at` пост публикуется немедленно)
- Smoke test: `DRY_RUN=true .venv/bin/python post.py "тест"` — `wall.post` не вызывается,
  только лог `DRY_RUN wall.post: ...`

Тестов, линтера и сборки в проекте нет — проверка запуском скрипта в `DRY_RUN`.

## Project layout

- `post.py` — CLI-обёртка: парсит аргументы, читает `.env`, вызывает `vk_poster`; exit code `0` = пост ушёл, `1` = упал
- `vk_poster.py` — VK API на aiohttp: `post_to_vk_now`, `post_to_vk_scheduled`, фото через `photos.getWallUploadServer` (+`saveWallPhoto`), видео через `video.save`; загрузка ЛЮБЫХ медиа идёт user-токеном (`VK_USER_TOKEN`), `wall.post` — ключом сообщества (`VK_GROUP_TOKEN`)
- `.env.example` — шаблон переменных (`VK_GROUP_TOKEN`, `VK_GROUP_ID`, опц. `VK_USER_TOKEN`, `VK_API_VERSION`, `DRY_RUN`)
- `CLIPS.md` — клипы ВК: `shortVideo.create` в сообщество, рабочий web-токен-механизм, наблюдения живых тестов, Playwright-фолбэк
- `clip_upload.py` — загрузка клипа в сообщество через `shortVideo.create` (нужен `VK_CLIP_TOKEN`, vkhost «vk.com»)
- `clip_web_upload.py` — ✅ РАБОЧИЙ путь клипов в сообщество: web-токен из кук сессии vk.ru + полный цикл `shortVideo.create` → upload → encodeProgress → edit → **publish (license_agree=1)** → verify `getOwnerVideos` (без `VK_CLIP_TOKEN`); куки — как в `--cookies` (JSON), права редактора/админа группы
- `README.md` — документация, лимиты ВК, граница ответственности с `minapp/`

## Code style

- Python 3.10+, аннотации типов во всех сигнатурах, `from __future__ import annotations`
- Даты — `datetime` с tz; `--at` принимает ISO 8601 с offset (`Z` → UTC), хранится/передаётся как unix-ts UTC
- Логи через `logging` в stdout: `OK: post_id=...` / `FAILED: ...`
- Ошибки VK — `VKError`; фото, которых нет на диске, пропускаются с warning в stderr

## VK constraints

- До 10 медиа на пост (фото + видео вместе; лишние отбрасываются с warning)
- Минимальный `publish_date` — обычно ~5 минут в будущем; «прошлые» даты ВК может отклонить или опубликовать сразу
- Длина текста до 16 384 символов (практически до 4000)
- Медиа-загрузка (и фото, и видео) принимает ТОЛЬКО ПОЛЬЗОВАТЕЛЬСКИЙ токен: `photos.getWallUploadServer` — право `photos` (ключ сообщества → error 27), `video.save` — право `video` (ключ сообщества → error 5). Оба в `VK_USER_TOKEN`
- Видео: форматы AVI/MP4/3GP/MPEG/MOV/MP3/FLV/WMV; `video.save(group_id=...)` сохраняет видео в сообщество (owner_id отрицательный); после загрузки видео обрабатывается ВК в фоне
- Ошибки видео: 22 Upload error, 204 Access denied, 214 нет прав на запись, 219 частый рекламный пост, 13000 активные баны сообщества
- Клипы (Clips): разнесение путей (проверено живьём 2026-08-16): на ЛИЧНУЮ страницу пользователя вертикаль (в т.ч. 3:4) через `video.save` без `group_id` + `wall.post` → клип (`type: short_video`) — бубен не нужен; в СООБЩЕСТВО горизонталь → обычный API `video.save(group_id)` + `wall.post`; в СООБЩЕСТВО вертикаль (клип) → ТОЛЬКО `shortVideo.create` (закрытый метод, токен официального приложения). Web-токен: перехват ответа `login.vk.ru/?act=web_token` (SPA сама дёргает; в DOM токена НЕТ), 220 символов, короткоживущий ~5-10 мин (error 5); права редактора/админа группы, иначе error 15. **ПОЛНЫЙ РАБОЧИЙ ФЛОУ (доказан живьём 2026-08-16, раздел «Клипы» группы 96798355 = 4 клипа: 456239214/215/217/220, `getOwnerVideos` count=4)**: всё через `api.vk.ru/method/*` c `v=5.285&client_id=6287487`: `shortVideo.getGroupsForUploading` → `shortVideo.create(file_size, group_id)` → POST `upload_url` (ovu.mycdn.me, multipart `file`) → поллинг `shortVideo.encodeProgress(video_id, owner_id, hash)` до `is_ready: true` → `shortVideo.edit` (description, privacy_view=all, can_make_duet=1, privacy_comment=all, thumb_id=united:0_<owner>) → **`shortVideo.publish(video_id, owner_id, wallpost=1, publish_date=0, license_agree=1, ref=link)`** — ГЛАВНЫЙ СЕКРЕТ: параметр называется **`license_agree`**, НЕ `license_agreement` (любые варианты с `license_agreement` → error 100 «must by true»; с `license_agree=1` работает и напрямую по API без браузера). Две кнопки в UI: `clips-publish-button` (upload-страница, ОТКРЫВАЕТ модалку «Новый клип») vs `clips-uploadForm-publish-button` (форма публикации после is_ready, реально ПУБЛИКУЕТ, может быть ниже скролла — v4 нажал через `button:has-text('Опубликовать')` + scroll_into_view). Клипы НЕ видны в `video.get` (видеотека — только `type: video`; по прямому id `video.get?videos=-<gid>_<vid>` отдаёт клип) и НЕ попадают на стену (ни `wallpost=1`, ни `wall.post` с вложением — отбрасывается; стена 92478300 из 249 постов — 0 клип-вложений). Эталон существования клипов в сообществе: группа 92478300. Скрипты: `clip_web_upload.py` (куки/web-токен, ПОЛНЫЙ цикл включая publish + verify getOwnerVideos, ✅ проверен живьём), `clip_upload.py` (VK_CLIP_TOKEN, не проверен живьём); детали и Playwright-флоу в CLIPS.md

## Scope (boundary)

Постит только готовый контент. Вне скоупа: Telegram-бот, генерация текста постов,
парсинг расписаний, демон/cron/очередь файлов, превью/премодерация.

## PR & commit conventions

- Ветки от `main`; в `main` напрямую не пушить
- Conventional commits: `feat:` / `fix:` / `docs:` / `refactor:`

## Security

- `.env` с `VK_GROUP_TOKEN` в `.gitignore` — токен никогда не коммитить
- `DRY_RUN=true` — единственный безопасный способ проверить код без публикации в сообщество
