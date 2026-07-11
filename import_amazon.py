#!/usr/bin/env python3
"""Import Kindle highlights from an Amazon notebook JSON export into vault/raw/books/*.md.

The JSON contract (produced by the bookmarklet in tools/, or by hand):

    {
      "title": "Show Your Work",
      "author": "Austin Kleon",
      "highlights": [
        {"text": "...", "location": "245", "page": "18", "note": "optional"}
      ]
    }

A whole-library export wraps books in a list: {"books": [<book>, <book>, ...]}.
Output format is identical to a Kindle-device sync: same renderer, same stable
block IDs (sha1 over title|type|location|text).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

from sync import Clip, dedupe, group_books, write_vault


def books_from_payload(payload: object) -> list[dict]:
    if isinstance(payload, dict) and "books" in payload:
        return list(payload["books"])
    if isinstance(payload, dict):
        return [payload]
    raise ValueError("JSON root must be a book object or {\"books\": [...]}")


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clips_from_book(book: dict) -> list[Clip]:
    title = _clean(book.get("title"))
    if not title:
        raise ValueError("book is missing a title")
    author = _clean(book.get("author"))
    clips: list[Clip] = []
    for entry in book.get("highlights", []):
        text = _clean(entry.get("text"))
        location = _clean(entry.get("location"))
        page = _clean(entry.get("page"))
        if text:
            clips.append(Clip(title, author, "highlight", page, location, None, text))
        note = _clean(entry.get("note"))
        if note:
            clips.append(Clip(title, author, "note", page, location, None, note))
    return clips


def archive_export(source: Path, root: Path) -> Path:
    copies = root / "vault" / "raw" / "clippings"
    copies.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    copy_path = copies / f"{stamp}-amazon-notebook.json"
    shutil.copy2(source, copy_path)
    return copy_path


def run(source: Path, root: Path) -> int:
    if not source.exists():
        print(f"Export file not found: {source}", file=sys.stderr)
        return 1
    copy_path = archive_export(source, root)
    try:
        payload = json.loads(copy_path.read_text(encoding="utf-8"))
        books = books_from_payload(payload)
        clips = [clip for book in books for clip in clips_from_book(book)]
    except (ValueError, KeyError) as exc:
        print(f"Could not parse export: {exc}", file=sys.stderr)
        return 1
    grouped = group_books(dedupe(clips))
    synced_on = datetime.now().strftime("%Y-%m-%d")
    new_clips, changed = write_vault(grouped, root / "vault" / "raw" / "books", synced_on)
    print(
        f"{new_clips} new clips across {changed} books "
        f"({len(clips)} clips in {len(grouped)} books total)"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Import an Amazon notebook JSON export into the vault."
    )
    parser.add_argument("source", type=Path, help="path to the JSON export")
    args = parser.parse_args(argv)
    return run(args.source, Path(__file__).resolve().parent)


if __name__ == "__main__":
    sys.exit(main())
