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

## Scope (boundary)

Постит только готовый контент. Вне скоупа: Telegram-бот, генерация текста постов,
парсинг расписаний, демон/cron/очередь файлов, превью/премодерация.

## PR & commit conventions

- Ветки от `main`; в `main` напрямую не пушить
- Conventional commits: `feat:` / `fix:` / `docs:` / `refactor:`

## Security

- `.env` с `VK_GROUP_TOKEN` в `.gitignore` — токен никогда не коммитить
- `DRY_RUN=true` — единственный безопасный способ проверить код без публикации в сообщество
