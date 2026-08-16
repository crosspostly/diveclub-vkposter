"""Upload a CLIP to a VK community using the web-session token.

Mechanism (found and PROVEN live 2026-08-16):
- The vk.ru SPA embeds window.vk.webToken.access_token in every page served to
  a logged-in session. It is an OFFICIAL web-app token -> shortVideo.create is
  a real method for it (error 3 only appears for VFeed/community tokens).
- The token user MUST be an editor/admin of the target group (else error 15).
- shortVideo.create(group_id, wallpost=1, description, file_size) -> upload_url
  -> POST multipart field 'file', UA 'vk-test-clip-upload 1'
  -> HTTP 200 + <retval>1</retval> (old) OR JSON {video_hash,size,owner_id,
  video_id} (new) = clip created.
- The clip lands in the group's КЛИПЫ section as type=short_video object
  (owner_id negative, is_united_video=1, repeat=1). It does NOT show in the
  group video list (video.get) and does NOT appear on the wall (wallpost=1
  and wall.post with the clip attachment are silently dropped by VK).

Usage:
    python clip_web_upload.py --cookies vk_cookies.json --video clip.mp4 \
        --text "описание" [--group 96798355] [--wallpost 1]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import aiohttp

API = "https://api.vk.com/method/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def cookie_header(cookies: list[dict]) -> str:
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


async def get_web_token(session: aiohttp.ClientSession, cookies_hdr: str) -> str | None:
    """Fetch any vk.ru page and extract the embedded official web access_token."""
    async with session.get("https://vk.ru/clips-96798355",
                           headers={"Cookie": cookies_hdr, "User-Agent": UA}) as r:
        html = await r.text()
    m = re.search(r'"webToken":\s*\{\s*"access_token":"([^"]+)"', html)
    if not m:
        m = re.search(r'webToken:\s*\{\s*"access_token":"([^"]+)"', html)
    return m.group(1) if m else None


async def call(session: aiohttp.ClientSession, method: str, token: str,
               params: dict) -> dict:
    data = {"v": "5.199", "access_token": token, **params}
    async with session.post(API + method, data=data) as r:
        return await r.json()


async def upload_clip(cookies_path: Path, video_path: Path, text: str,
                      group_id: str, wallpost: int) -> int:
    cookies = json.loads(cookies_path.read_text(encoding="utf-8"))
    ch = cookie_header(cookies)
    file_size = video_path.stat().st_size
    print(f"video: {video_path} size={file_size}")

    async with aiohttp.ClientSession() as session:
        token = await get_web_token(session, ch)
        if not token:
            print("FAILED: webToken не найден — куки неавторизованные/просроченные?")
            return 1
        print(f"web token OK (len={len(token)})")

        r = await call(session, "shortVideo.create", token, {
            "group_id": group_id, "wallpost": wallpost,
            "description": text, "file_size": file_size,
        })
        if "error" in r:
            err = r["error"]
            print(f"FAILED: shortVideo.create error {err.get('error_code')}: "
                  f"{err.get('error_msg')}")
            return 1
        created = r["response"]
        owner_id = created.get("owner_id")
        video_id = created.get("video_id")
        upload_url = created.get("upload_url")
        print(f"OK: shortVideo.create owner={owner_id} video_id={video_id}")

        with video_path.open("rb") as f:
            form = aiohttp.FormData()
            form.add_field("file", f, filename=video_path.name,
                           content_type="video/mp4")
            async with session.post(
                upload_url, data=form,
                headers={"user-agent": "vk-test-clip-upload 1"},
                timeout=aiohttp.ClientTimeout(total=900),
            ) as r:
                status = r.status
                body = (await r.text()).strip()
        print(f"upload status={status} body={body[:200]}")
        # VK returns two accepted formats: old HTML <retval>1</retval> and new JSON
        # {"video_hash":..., "video_id":..., "owner_id":...}
        ok_old = "<retval>1</retval>" in body
        try:
            j = json.loads(body)
            ok_json = isinstance(j, dict) and "video_id" in j
            if ok_json and j.get("video_id"):
                video_id = j["video_id"]
            if ok_json and j.get("owner_id"):
                owner_id = j["owner_id"]
        except Exception:
            ok_json = False
        if status != 200 or not (ok_old or ok_json):
            print("FAILED: загрузка клипа не подтверждена")
            return 1
        print(f"OK: клип загружен -> https://vk.ru/clip{owner_id}_{video_id}")

        print("waiting 35s for VK processing...")
        await asyncio.sleep(35)

        r = await call(session, "video.get", token, {"videos": f"{owner_id}_{video_id}"})
        item = r.get("response", {}).get("items", [])
        print("video.get:", json.dumps(r, ensure_ascii=False)[:800])
        if item:
            print("TYPE:", item[0].get("type"), "| title:", item[0].get("title"))

        r = await call(session, "wall.get", token, {"owner_id": -int(group_id), "count": 1})
        items = r.get("response", {}).get("items", [])
        if items:
            for a in items[0].get("attachments", []):
                print("wall attachment type:", a.get("type"))
        print("Проверь сам: https://vk.ru/clips-96798355")
        return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Загрузить клип в сообщество ВК (web-токен)")
    p.add_argument("--cookies", required=True, help="путь к JSON-файлу с куками vk.ru")
    p.add_argument("--video", required=True, help="путь к видеофайлу (вертикаль MP4)")
    p.add_argument("--text", default="", help="описание клипа")
    p.add_argument("--group", default="96798355", help="ID сообщества")
    p.add_argument("--wallpost", type=int, default=1, choices=(0, 1))
    args = p.parse_args()
    cookies_path = Path(args.cookies)
    video_path = Path(args.video)
    if not cookies_path.exists():
        print(f"FAILED: куки не найдены: {cookies_path}")
        return 1
    if not video_path.exists():
        print(f"FAILED: видео не найдено: {video_path}")
        return 1
    return asyncio.run(upload_clip(cookies_path, video_path, args.text,
                                   args.group, args.wallpost))


if __name__ == "__main__":
    raise SystemExit(main())
