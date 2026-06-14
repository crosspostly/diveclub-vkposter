"""post.py — put one post into VK scheduled posting.

Usage:
  python post.py "Текст поста" --at 2026-06-15T09:00:00+03:00 [--photo p.jpg ...]

That is the whole script. It calls wall.post with publish_date and exits.
VK holds the post and publishes it at the given time. No daemon, no queue,
no buttons, no preview, no Telegram.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

import vk_poster

ROOT = Path(__file__).parent.resolve()
load_dotenv(ROOT / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("post")


def _parse_at(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError(f"--at must include timezone offset, got: {s!r}")
    return dt.astimezone(timezone.utc)


def _filter_photos(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for src in paths:
        p = Path(src)
        if not p.exists():
            print(f"warning: photo not found, skipping: {src}", file=sys.stderr)
            continue
        out.append(p)
    if len(out) > 10:
        print(
            f"warning: VK allows up to 10 photos; dropping last {len(out) - 10}",
            file=sys.stderr,
        )
        out = out[:10]
    return out


async def _run(body: str, at: datetime | None, photos: list[Path]) -> int:
    try:
        if at is None:
            r = await vk_poster.post_to_vk_now(body, image_paths=photos or None)
        else:
            r = await vk_poster.post_to_vk_scheduled(
                body,
                publish_date=int(at.timestamp()),
                image_paths=photos or None,
            )
    except Exception as e:
        logger.exception("wall.post failed")
        print(f"FAILED: {e}", file=sys.stderr)
        return 1
    print(f"OK: post_id={r.get('post_id')}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Put one post into VK scheduled posting.")
    p.add_argument("body", help="Post text.")
    p.add_argument(
        "--at",
        default=None,
        help="ISO 8601 publish time with TZ offset, e.g. '2026-06-15T09:00:00+03:00'. "
             "If omitted, posts right now.",
    )
    p.add_argument(
        "--photo",
        action="append",
        default=[],
        help="Path to a photo (repeatable, up to 10).",
    )
    args = p.parse_args()
    at = _parse_at(args.at) if args.at else None
    photos = _filter_photos(args.photo)
    return asyncio.run(_run(args.body, at, photos))


if __name__ == "__main__":
    raise SystemExit(main())
