# diveclub — отложенный постинг ВК

Один вызов скрипта → несколько постов с `publish_date` на стену
сообщества. Скрипт завершает работу сразу после отправки всех
`wall.post`. **Никакого демона, никаких тиков, никаких снов.**

## Файлы

```
post.py              # CLI: post.py "Текст" --at ISO_TIME
vk_poster.py         # VK API: post_to_vk_now + post_to_vk_scheduled
.env.example         # шаблон VK_GROUP_TOKEN, VK_GROUP_ID
requirements.txt     # aiohttp, python-dotenv
```

## Развёртывание

```bash
cd /home/varsmana/diveclub
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
nano .env          # VK_GROUP_TOKEN, VK_GROUP_ID
```

## Использование

Один пост:
```bash
.venv/bin/python post.py "Текст поста" \
  --at 2026-06-15T09:00:00+03:00 \
  --photo img1.jpg --photo img2.jpg
```

Несколько постов (через `--more`):
```bash
.venv/bin/python post.py \
  "📅 Пн 16.06 — бассейн 19:00" \
  --at 2026-06-15T09:00:00+03:00 \
  --photo p1.jpg \
  --more "📅 Ср 18.06 — открытая вода|||2026-06-17T09:00:00+03:00|||" \
  --more "📅 Пт 20.06 — теория|||2026-06-19T09:00:00+03:00|||p2.jpg|p3.jpg"
```

Формат `--more`: `ТЕКСТ|||ISO_AT|||фото1.jpg|фото2.jpg` (три пайпа
разделяют, фото через одиночный пайп, можно пустые — `|||` в конце).

Сразу без расписания (опубликуется немедленно):
```bash
.venv/bin/python post.py "Текст поста прямо сейчас" --photo img.jpg
```

## Что происходит

1. Скрипт читает `.env`, валидирует `--at` (ISO 8601 с TZ-offset).
2. Для каждого поста вызывает `wall.post` с `publish_date=unix_ts`.
3. ВК сам хранит пост и публикует в указанное время. Скрипт **не
   засыпает**, **не крутится в цикле**, завершается сразу.
4. Логи в stdout: `OK: post_id=...` или `FAILED: ...`.
5. Exit code: `0` если все посты ушли, `1` если хоть один упал.

## Smoke-тест без публикации

В `.env` поставьте `DRY_RUN=true` — `wall.post` не вызывается, в
логах `DRY_RUN wall.post: scheduled ts=…`.

## Лимиты ВК

- До 10 фото на пост.
- Минимальный `publish_date` — обычно 5 минут в будущем от текущего
  времени ВК. Посты «в прошлом» ВК может либо отклонить, либо
  опубликовать немедленно — зависит от настроек сообщества.
- Длина текста поста — до 16 384 символов (практически лучше до 4000).
