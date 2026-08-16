"""Загрузка клипа (short video) в сообщество ВК через shortVideo.create.

Это отдельный путь от обычного видео (video.save): shortVideo.create кладёт
ролик в раздел «Клипы» сообщества. Метод закрытый (не в dev.vk.com), поэтому:

- ТОЛЬКО user-токен от ОФИЦИАЛЬНОГО приложения ВК (vkhost.github.io -> кнопка
  «vk.com»), обычный токен (VFeed и т.п.) и ключ сообщества -> error 3
  «Unknown method passed».
- Токен кладётся в .env как VK_CLIP_TOKEN (отдельно от VK_USER_TOKEN).

Флоу (проверено сообществом: ru.stackoverflow.com/q/1604402, v-h.guru/39114):
1. shortVideo.create(group_id, wallpost, description, file_size) -> upload_url
2. POST upload_url: multipart-поле `file`, user-agent «vk-test-clip-upload 1»
3. Успех = HTTP 200 + тело <retval>1</retval>

Формат ролика (рекомендации): вертикаль 9:16 (1080x1920), 3 сек – 3 мин, H.264.

Запуск:
    .venv/bin/python clip_upload.py clip.mp4 "Описание #хештег" [--wallpost 1]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import aiohttp

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://api.vk.com/method/"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


async def upload_clip(token: str, group_id: str, api_v: str,
                      video_path: Path, text: str, wallpost: int) -> int:
    file_size = video_path.stat().st_size

    async with aiohttp.ClientSession() as session:
        # 1. shortVideo.create
        data = {
            "v": api_v,
            "access_token": token,
            "group_id": group_id,
            "wallpost": wallpost,
            "description": text,
            "file_size": file_size,
        }
        async with session.post(API + "shortVideo.create", data=data) as resp:
            payload = await resp.json()
        if "error" in payload:
            err = payload["error"]
            print(f"FAILED: shortVideo.create error {err.get('error_code')}: {err.get('error_msg')}")
            return 1
        created = payload["response"]
        upload_url = created["upload_url"]
        owner_id = created.get("owner_id")
        video_id = created.get("video_id")
        print(f"OK: shortVideo.create owner={owner_id} video_id={video_id}")

        # 2. Загрузка файла на upload_url
        form = aiohttp.FormData()
        form.add_field("file", video_path.open("rb"), filename=video_path.name,
                       content_type="video/mp4")
        headers = {"user-agent": "vk-test-clip-upload 1"}
        async with session.post(upload_url, data=form, headers=headers) as resp:
            status = resp.status
            body = (await resp.text()).strip()
        print(f"upload status={status} body={body[:200]}")
        if status != 200 or "<retval>1</retval>" not in body:
            print(f"FAILED: загрузка клипа не подтверждена (retval != 1): {body[:200]}")
            return 1

        print(f"OK: клип загружен -> https://vk.ru/clip{owner_id}_{video_id}")
        print(f"OK: wallpost={wallpost} (0 = пост на стену делается отдельно через post.py)")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Загрузить клип в сообщество ВК")
    parser.add_argument("video", help="путь к видеофайлу (MP4, вертикаль)")
    parser.add_argument("text", nargs="?", default="", help="описание клипа")
    parser.add_argument("--wallpost", type=int, default=1, choices=(0, 1),
                        help="1 — сразу опубликовать на стену сообщества")
    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"FAILED: файл не найден: {video_path}")
        return 1

    env = load_env(Path(__file__).with_name(".env"))
    token = env.get("VK_CLIP_TOKEN") or os.environ.get("VK_CLIP_TOKEN", "")
    group_id = env.get("VK_GROUP_ID") or os.environ.get("VK_GROUP_ID", "")
    api_v = env.get("VK_API_VERSION") or os.environ.get("VK_API_VERSION", "5.199")

    if not token:
        print("FAILED: нет VK_CLIP_TOKEN (токен от vkhost 'vk.com') в .env")
        return 1
    if not group_id:
        print("FAILED: нет VK_GROUP_ID в .env")
        return 1

    return asyncio.run(upload_clip(token, group_id, api_v, video_path,
                                   args.text, args.wallpost))


if __name__ == "__main__":
    raise SystemExit(main())
