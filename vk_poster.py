"""vk_poster.py — publish a post to a VK community wall, with photos.

One-shot, no scheduling. Used by the agent (operator) via post.py.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

API = "https://api.vk.com/method"


class VKError(RuntimeError):
    pass


def _token() -> str:
    tok = os.environ.get("VK_GROUP_TOKEN", "").strip()
    if not tok:
        raise VKError("VK_GROUP_TOKEN is empty")
    return tok


def _group_id() -> int:
    gid = os.environ.get("VK_GROUP_ID", "").strip()
    if not gid.lstrip("-").isdigit():
        raise VKError("VK_GROUP_ID is not numeric")
    return int(gid)


def _api_version() -> str:
    return os.environ.get("VK_API_VERSION", "5.199")


def _is_dry_run() -> bool:
    return os.environ.get("DRY_RUN", "false").lower() in ("1", "true", "yes")


async def _call(
    session: aiohttp.ClientSession,
    method: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    params = {**params, "access_token": _token(), "v": _api_version()}
    async with session.post(f"{API}/{method}", params=params) as r:
        data = await r.json()
    if "error" in data:
        raise VKError(f"{method}: {data['error']}")
    return data.get("response", {})


async def _upload_photo(
    session: aiohttp.ClientSession,
    upload_url: str,
    file_path: Path,
) -> dict[str, Any]:
    form = aiohttp.FormData()
    form.add_field(
        "photo",
        file_path.open("rb"),
        filename=file_path.name,
        content_type="application/octet-stream",
    )
    async with session.post(upload_url, data=form) as r:
        data = await r.json()
    if "error" in data:
        raise VKError(f"upload: {data['error']}")
    return data


async def _attach_photos(
    session: aiohttp.ClientSession,
    image_paths: list[Path],
) -> str:
    """Upload images and return a comma-separated 'photo<owner>_<id>,...' string."""
    ids: list[str] = []
    for p in image_paths:
        server = await _call(
            session,
            "photos.getWallUploadServer",
            {"group_id": _group_id()},
        )
        up = await _upload_photo(session, server["upload_url"], p)
        saved = await _call(
            session,
            "photos.saveWallPhoto",
            {
                "group_id": _group_id(),
                "photo": up["photo"],
                "server": up["server"],
                "hash": up["hash"],
            },
        )
        photo = saved[0]
        ids.append(f"photo{photo['owner_id']}_{photo['id']}")
    return ",".join(ids)


async def post_to_vk_now(
    body: str,
    *,
    image_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Publish a post immediately to the community wall (no publish_date)."""
    if _is_dry_run():
        logger.info(
            "DRY_RUN wall.post: NOW body_len=%d images=%d",
            len(body), len(image_paths or []),
        )
        return {"post_id": 0, "dry_run": True}

    async with aiohttp.ClientSession() as session:
        params: dict[str, Any] = {
            "owner_id": -_group_id(),
            "from_group": 1,
            "message": body,
            "signed": 0,
        }
        if image_paths:
            params["attachments"] = await _attach_photos(session, image_paths)
        return await _call(session, "wall.post", params)


async def post_to_vk_scheduled(
    body: str,
    *,
    publish_date: int,
    image_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Schedule a post on the community wall via wall.post publish_date.

    The call returns immediately; VK stores the post and publishes it at
    publish_date (unix timestamp, UTC).
    """
    if _is_dry_run():
        logger.info(
            "DRY_RUN wall.post: scheduled ts=%s body_len=%d images=%d",
            publish_date, len(body), len(image_paths or []),
        )
        return {"post_id": 0, "dry_run": True}

    async with aiohttp.ClientSession() as session:
        params: dict[str, Any] = {
            "owner_id": -_group_id(),
            "from_group": 1,
            "message": body,
            "publish_date": publish_date,
            "signed": 0,
        }
        if image_paths:
            params["attachments"] = await _attach_photos(session, image_paths)
        return await _call(session, "wall.post", params)
