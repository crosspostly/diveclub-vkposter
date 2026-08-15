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

# Video files can be big (up to ~1 GB); give the upload request a long timeout.
VIDEO_UPLOAD_TIMEOUT = 3600  # seconds


class VKError(RuntimeError):
    pass


def _token() -> str:
    tok = os.environ.get("VK_GROUP_TOKEN", "").strip()
    if not tok:
        raise VKError("VK_GROUP_TOKEN is empty")
    return tok


def _user_token() -> str:
    """Token for video.save: VK requires a *user* access token with the
    'video' scope to upload video. Community keys cannot upload video."""
    tok = os.environ.get("VK_USER_TOKEN", "").strip()
    if not tok:
        raise VKError(
            "VK_USER_TOKEN is empty: video upload needs a user access token "
            "with the 'video' scope (community keys cannot upload video)"
        )
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
    *,
    token: str | None = None,
) -> dict[str, Any]:
    params = {**params, "access_token": token or _token(), "v": _api_version()}
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


async def _upload_video_file(
    session: aiohttp.ClientSession,
    upload_url: str,
    file_path: Path,
) -> dict[str, Any]:
    """POST the video file to upload_url (multipart field 'video_file')."""
    form = aiohttp.FormData()
    form.add_field(
        "video_file",
        file_path.open("rb"),
        filename=file_path.name,
        content_type="application/octet-stream",
    )
    async with session.post(
        upload_url,
        data=form,
        timeout=aiohttp.ClientTimeout(total=VIDEO_UPLOAD_TIMEOUT),
    ) as r:
        data = await r.json()
    if "error" in data:
        raise VKError(f"video upload: {data['error']}")
    return data


async def _upload_videos(
    session: aiohttp.ClientSession,
    video_paths: list[Path],
) -> list[str]:
    """Upload videos to the community's video list and return attachment ids
    like 'video-<group_id>_<video_id>[_<access_key>]'.

    VK saves the video into the community (group_id), so the post attached to
    it and published with from_group=1 is owned by the community.
    """
    ids: list[str] = []
    for p in video_paths:
        saved = await _call(
            session,
            "video.save",
            {
                "group_id": _group_id(),
                "name": p.stem[:128],
                "wallpost": 0,
            },
            token=_user_token(),
        )
        up = await _upload_video_file(session, saved["upload_url"], p)
        owner = up.get("owner_id") or saved.get("owner_id")
        vid = up.get("video_id") or saved.get("video_id")
        acc = up.get("access_key") or saved.get("access_key") or ""
        att = f"video{owner}_{vid}"
        if acc:
            att += f"_{acc}"
        logger.info("uploaded video %s (%s)", att, p.name)
        ids.append(att)
    return ids


async def post_to_vk_now(
    body: str,
    *,
    image_paths: list[Path] | None = None,
    video_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Publish a post immediately to the community wall (no publish_date)."""
    if _is_dry_run():
        logger.info(
            "DRY_RUN wall.post: NOW body_len=%d images=%d videos=%d",
            len(body), len(image_paths or []), len(video_paths or []),
        )
        return {"post_id": 0, "dry_run": True}

    async with aiohttp.ClientSession() as session:
        params: dict[str, Any] = {
            "owner_id": -_group_id(),
            "from_group": 1,
            "message": body,
            "signed": 0,
        }
        attachments = await _build_attachments(session, image_paths, video_paths)
        if attachments:
            params["attachments"] = attachments
        return await _call(session, "wall.post", params)


async def post_to_vk_scheduled(
    body: str,
    *,
    publish_date: int,
    image_paths: list[Path] | None = None,
    video_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Schedule a post on the community wall via wall.post publish_date.

    The call returns immediately; VK stores the post and publishes it at
    publish_date (unix timestamp, UTC).
    """
    if _is_dry_run():
        logger.info(
            "DRY_RUN wall.post: scheduled ts=%s body_len=%d images=%d videos=%d",
            publish_date, len(body), len(image_paths or []), len(video_paths or []),
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
        attachments = await _build_attachments(session, image_paths, video_paths)
        if attachments:
            params["attachments"] = attachments
        return await _call(session, "wall.post", params)


async def _build_attachments(
    session: aiohttp.ClientSession,
    image_paths: list[Path] | None,
    video_paths: list[Path] | None,
) -> str:
    """Upload photos + videos and return comma-separated attachment ids."""
    parts: list[str] = []
    if image_paths:
        parts.append(await _attach_photos(session, image_paths))
    if video_paths:
        parts.extend(await _upload_videos(session, video_paths))
    return ",".join(parts)
