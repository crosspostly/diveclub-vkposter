# diveclub/vkposter — отложенный постинг ВК

Один вызов скрипта → один пост с `publish_date` на стену сообщества
ВК. Скрипт завершает работу сразу после отправки `wall.post`.
**Никакого демона, никаких тиков, никаких снов, никаких кнопок.**

## Структура

```
vkposter/
├── post.py              # CLI: post.py "Текст" --at ISO --photo ...
├── vk_poster.py         # VK API: post_to_vk_now + post_to_vk_scheduled
├── .env.example         # шаблон VK_GROUP_TOKEN, VK_GROUP_ID
├── requirements.txt     # aiohttp, python-dotenv
├── .venv/
├── .gitignore
└── README.md            # этот файл
```

## Развёртывание

```bash
cd /home/varsmana/diveclub/vkposter
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
nano .env          # VK_GROUP_TOKEN, VK_GROUP_ID
```

## Использование

```bash
.venv/bin/python post.py "Текст поста" \
  --at 2026-06-15T09:00:00+03:00 \
  --photo img1.jpg --photo img2.jpg
```

Сразу без расписания (опубликуется немедленно):

```bash
.venv/bin/python post.py "Текст поста прямо сейчас" --photo img.jpg
```

## Что происходит

1. Скрипт читает `.env`, валидирует `--at` (ISO 8601 с TZ-offset).
2. Вызывает `wall.post` с `publish_date=unix_ts`.
3. ВК сам хранит пост и публикует в указанное время. Скрипт **не
   засыпает**, **не крутится в цикле**, завершается сразу.
4. Логи в stdout: `OK: post_id=...` или `FAILED: ...`.
5. Exit code: `0` если пост ушёл, `1` если упал.

## Smoke-тест без публикации

В `.env` поставьте `DRY_RUN=true` — `wall.post` не вызывается, в
логах `DRY_RUN wall.post: scheduled ts=…`.

## Лимиты ВК

- До 10 фото на пост.
- Минимальный `publish_date` — обычно 5 минут в будущем от текущего
  времени ВК. Посты «в прошлом» ВК может либо отклонить, либо
  опубликовать немедленно — зависит от настроек сообщества.
- Длина текста поста — до 16 384 символов (практически лучше до 4000).

## Где взять токен ВК

1. Управление сообществом → Настройки → Работа с API → Ключи доступа.
2. Создайте ключ с правами: **wall**, **photos**, **groups**, **offline**.
3. `VK_GROUP_ID` — числовой id сообщества. В адресной строке
   `vk.com/club123456789` → id = `123456789`.

## Граница ответственности (diveclub/)

```
diveclub/
├── minapp/      → github.com/crosspostly/diveclub
│                 VK Mini App «Навионик» (frontend, backend, common).
│
└── vkposter/    → github.com/crosspostly/diveclub-vkposter  ← ВЫ ЗДЕСЬ
                  CLI для отложенного постинга готового контента в ВК.
```

- **`minapp/`** отвечает за VK Mini App: интерфейс, квизы, расписание
  в виде мини-приложения.
- **`vkposter/`** отвечает за постинг готового контента на стену
  сообщества ВК через нативный `wall.post publish_date`.

Что **не** входит в `vkposter`:
- ❌ Telegram-бот
- ❌ Claude API в рантайме
- ❌ Генерация текста постов (делается в чате, агентом)
- ❌ Парсинг расписаний
- ❌ Демон / cron / systemd unit
- ❌ Очередь файлов
- ❌ Кнопки / превью / премодерация
