#!/usr/bin/env python3
"""Sync Kindle highlights from My Clippings.txt into vault/books/*.md."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime

SEPARATOR = "=========="
DATE_FMT = "%A, %B %d, %Y %I:%M:%S %p"
TITLE_RE = re.compile(r"^(?P<title>.*?)(?:\s*\((?P<author>[^()]*)\))?\s*$")
META_RE = re.compile(
    r"^- Your (?P<type>Highlight|Note|Bookmark)"
    r"(?: on page (?P<page>[^|]+?))?"
    r"(?:\s*\|?\s*(?:at )?location (?P<location>[\d-]+))?"
    r"(?:\s*\|\s*Added on (?P<date>.+))?$"
)


@dataclass
class Clip:
    title: str
    author: str | None
    type: str  # "highlight" | "note" | "bookmark"
    page: str | None
    location: str | None
    date: datetime | None
    text: str

    @property
    def id(self) -> str:
        key = f"{self.title}|{self.type}|{self.location}|{self.text}"
        return hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def parse_entry(block: str) -> Clip | None:
    lines = [line.rstrip("\r") for line in block.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) < 2:
        return None
    m_title = TITLE_RE.match(lines[0].lstrip("﻿"))
    m_meta = META_RE.match(lines[1])
    if not m_title or not m_meta:
        return None
    date = None
    if m_meta.group("date"):
        try:
            date = datetime.strptime(m_meta.group("date").strip(), DATE_FMT)
        except ValueError:
            pass
    page = m_meta.group("page")
    author = (m_title.group("author") or "").strip()
    return Clip(
        title=m_title.group("title").strip(),
        author=author or None,
        type=m_meta.group("type").lower(),
        page=page.strip() if page else None,
        location=m_meta.group("location"),
        date=date,
        text="\n".join(lines[2:]).strip(),
    )


def parse_clippings(text: str) -> list[Clip]:
    clips = []
    for block in text.lstrip("﻿").split(SEPARATOR):
        clip = parse_entry(block)
        if clip is not None:
            clips.append(clip)
    return clips


def dedupe(clips: list[Clip]) -> list[Clip]:
    best: dict[str, Clip] = {}
    order: list[str] = []
    for clip in clips:
        cid = clip.id
        if cid not in best:
            best[cid] = clip
            order.append(cid)
        elif (clip.date or datetime.min) > (best[cid].date or datetime.min):
            best[cid] = clip
    return [best[cid] for cid in order]


TYPE_RANK = {"highlight": 0, "note": 1, "bookmark": 2}


def location_start(clip: Clip) -> int:
    if not clip.location:
        return 0
    return int(clip.location.split("-")[0])


def group_books(clips: list[Clip]) -> dict[tuple[str, str | None], list[Clip]]:
    books: dict[tuple[str, str | None], list[Clip]] = {}
    for clip in clips:
        books.setdefault((clip.title, clip.author), []).append(clip)
    for key in books:
        books[key].sort(key=lambda c: (location_start(c), TYPE_RANK[c.type]))
    return books


def meta_parts(clip: Clip) -> list[str]:
    parts = []
    if clip.page:
        parts.append(f"p. {clip.page}")
    if clip.location:
        parts.append(f"loc. {clip.location}")
    if clip.date:
        parts.append(clip.date.strftime("%Y-%m-%d"))
    return parts


def meta_line(clip: Clip) -> str:
    return " · ".join([clip.type] + meta_parts(clip))


def render_clip(clip: Clip) -> str:
    if clip.type == "highlight":
        quoted = "\n".join(f"> {line}" for line in clip.text.split("\n"))
        return f"{quoted}\n>\n> — {meta_line(clip)} ^{clip.id}"
    if clip.type == "note":
        return f"Note: {clip.text}\n— {meta_line(clip)} ^{clip.id}"
    return f"{' · '.join(['Bookmark'] + meta_parts(clip))} ^{clip.id}"
