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
