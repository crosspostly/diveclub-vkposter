"""Upload a CLIP to a VK community using the web-session token (FULL flow, proven).

Mechanism (found and PROVEN live 2026-08-16, group 96798355, 4 clips in section):
- The vk.ru SPA fetches an OFFICIAL web-app token from
  POST login.vk.ru/?act=web_token (version=1&app_id=6287487&access_token=...)
  on every logged-in page load. For this token shortVideo.* are real methods
  (error 3 only for VFeed/community tokens). It is short-lived (~5-10 min,
  then error 5) — obtain it right before the calls.
- The token user MUST be an editor/admin of the target group (else error 15).

Full proven flow (all api.vk.ru/method/*, v=5.285, client_id=6287487):
  1. shortVideo.getGroupsForUploading        -> list of groups (admin_level)
  2. shortVideo.create(file_size, group_id)  -> {owner_id, video_id, upload_url}
  3. POST upload_url (ovu.mycdn.me, multipart field 'file', UA 'vk-test-clip-upload 1')
     -> JSON {video_hash, size, owner_id, video_id}
  4. poll shortVideo.encodeProgress(video_id, owner_id, hash) until is_ready=true
  5. shortVideo.edit(video_id, owner_id, description, privacy_view=all,
     can_make_duet=1, privacy_comment=all, thumb_id=united:0_<owner>, ...)
  6. shortVideo.publish(video_id, owner_id, wallpost=1, publish_date=0,
     license_agree=1, ref=link)
     -> 200 {response:{video:...}} = clip IS in the group's КЛИПЫ section
     (shortVideo.getOwnerVideos count>0)

KEY: the magic param is license_agree=1 (NOT license_agreement!). Every
variant with license_agreement returns error 100 "license_agreement must by
true"; license_agree=1 works and is what the real UI sends (captured from the
actual "Опубликовать" click, v4).

Two different buttons in the UI (both data-testid, see CLIPS.md):
  - clips-publish-button          -> upload page, OPENS the "Новый клип" modal
  - clips-uploadForm-publish-button -> publish-form page (after is_ready),
    actually PUBLISHES the clip (below the scroll on the form)

Clips do NOT show in video.get (library is type: video only), do NOT appear
on the wall (wallpost=1 and wall.post with clip attachment are dropped by VK),
live only in the group's КЛИПЫ section.

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

        # Poll encodeProgress until VK finishes processing (needs video_hash)
        video_hash = None
        try:
            j = json.loads(body)
            video_hash = j.get("video_hash")
        except Exception:
            video_hash = None
        if not video_hash:
            print("WARN: video_hash не получен из ответа загрузки — пропускаю поллинг")
        else:
            for i in range(120):
                r = await call(session, "shortVideo.encodeProgress", token, {
                    "video_id": video_id, "owner_id": owner_id, "hash": video_hash,
                })
                resp = r.get("response")
                if resp is None:
                    print(f"encodeProgress error: {json.dumps(r, ensure_ascii=False)[:200]}")
                    break
                is_ready = resp.get("is_ready", False)
                if i % 4 == 0 or is_ready:
                    print(f"encodeProgress: {resp.get('percents')}% is_ready={is_ready}")
                if is_ready:
                    break
                await asyncio.sleep(3)
            else:
                print("WARN: encodeProgress не дождался is_ready за 6 минут")

        # shortVideo.edit — exact params from the real UI (v4 capture)
        r = await call(session, "shortVideo.edit", token, {
            "video_id": video_id,
            "owner_id": owner_id,
            "description": text,
            "privacy_view": "all",
            "can_make_duet": "1",
            "privacy_comment": "all",
            "audio_raw_id": "",
            "attach_to_video_raw_id": "",
            "ord_info": '{"is_ads":false,"advertisers":[]}',
            "thumb_id": f"united:0_{owner_id}",
        })
        if "error" in r:
            print(f"WARN: shortVideo.edit error {r['error'].get('error_code')}: "
                  f"{r['error'].get('error_msg')}")
        else:
            print("OK: shortVideo.edit принят")

        # shortVideo.publish — THE magic call (license_agree=1, not license_agreement!)
        r = await call(session, "shortVideo.publish", token, {
            "video_id": video_id,
            "owner_id": owner_id,
            "wallpost": wallpost,
            "publish_date": "0",
            "license_agree": "1",
            "ref": "link",
        })
        if "error" in r:
            err = r["error"]
            print(f"FAILED: shortVideo.publish error {err.get('error_code')}: "
                  f"{err.get('error_msg')}")
            return 1
        print("OK: shortVideo.publish принят (200)")

        # Verify: clip must be in the group's КЛИПЫ section
        await asyncio.sleep(2)
        r = await call(session, "shortVideo.getOwnerVideos", token,
                       {"owner_id": f"-{group_id}", "count": "10"})
        resp = r.get("response", {})
        count = resp.get("count", 0)
        print(f"VERIFY: shortVideo.getOwnerVideos count={count}")
        for it in (resp.get("items") or [])[:10]:
            print("  clip:", {k: it.get(k) for k in ("id", "owner_id", "title", "type") if k in it})
        if count > 0:
            print(f"OK: клип в разделе «Клипы» https://vk.ru/clips-{group_id}")
            return 0
        print("WARN: getOwnerVideos = 0 — клип в разделе не появился")
        return 1


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
