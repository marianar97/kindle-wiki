# Research Wiki Migration Plan

**Date:** 2026-07-10
**Status:** Approved — building
**Spec:** `docs/superpowers/specs/manual-prod` (parts author-written, parts pasted;
inconsistencies below are resolved intentionally).

## Goal

Evolve the minimal Kindle-highlights concept wiki into a self-maintaining
**Research Wiki**: a three-layer knowledge base where `sync.py` lands immutable
source material and an LLM agent — the **keeper** of a living, growing organism —
builds, links, repairs, and prunes an interlinked markdown wiki over it.

## Decisions (settled with Mariana)

- **Source note = one page per highlight or Kindle note** (bookmarks skipped —
  they carry no text). Each source note embeds its one exact quote, adds a
  one-line gloss (what it means / why it matters), and links out to the
  concepts / authors / entities / themes it supports.
- **Quotes are embedded, never copied.** `sync.py` remains the deterministic
  authority for exact text + stable block IDs; source notes embed
  `![[<book-slug>#^id]]`. No transcription, no drift.
- **Book pages are LLM editorial hubs** (metadata + short summary + themes + an
  index of the book's source notes). The agent curates; it never re-types
  highlights.
- **Three layers, hard ownership line:** `raw/` is machine-owned and immutable
  (agent never edits); `wiki/` is LLM-owned; schema = `AGENTS.md` + `index.md` +
  `log.md`.
- **Full ontology scaffolded now:** concepts, authors, entities, themes,
  source-notes, syntheses, projects, books.
- **Schema file renamed** `CLAUDE.md` → `AGENTS.md` (tool-neutral; Cursor reads it).
- **Corpus is small (<200 clips):** ingest a whole book at a time; no batching
  machinery needed.
- **`raw/books/*.md` are committed** (the wiki's embeds depend on them);
  `raw/clippings/` copies stay gitignored.

### Resolved spec inconsistencies

- "Paulo" → Mariana. "debates" pages → folded into `themes/` (no separate folder).
- Ingest step writing to `wiki/highlights/` → `wiki/source-notes/`.
- "clusters" in the query workflow → the `themes/` layer.
- The per-source source-note template (Summary/Key Claims/multiple quotes) →
  replaced by a per-highlight template (embed + gloss + links).

## Target structure

```
kindle-wiki/
├── sync.py
├── AGENTS.md                     # renamed from CLAUDE.md, rewritten
└── vault/
    ├── raw/
    │   ├── clippings/             # timestamped My Clippings.txt copies (gitignored)
    │   └── books/                 # GENERATED per-book highlight files + ^block-ids (committed)
    └── wiki/
        ├── index.md               # navigation: every page grouped by type
        ├── log.md                 # append-only action log
        ├── books/                 # LLM editorial book hubs
        ├── authors/               # one page per author
        ├── concepts/              # one page per concept
        ├── entities/              # named real-world things
        ├── themes/                # broad clusters (the query nav layer)
        ├── source-notes/          # one page per highlight/note
        ├── syntheses/             # cross-source argumentative overviews
        └── projects/              # subfolder per active research/writing project
```

**Data flow:** `My Clippings.txt` → `sync.py` → `raw/clippings/` + `raw/books/*.md`.
Agent, following `AGENTS.md`, builds `wiki/` and keeps `index.md` / `log.md` current.

## Build order (each step independently checkable)

1. **sync.py paths** — clippings copies → `vault/raw/clippings/`; book files →
   `vault/raw/books/`. Update `.gitignore` and `tests/test_sync.py`. Parsing,
   dedupe, block IDs, idempotence unchanged. Verify: tests pass, `sync.py`
   populates `raw/`.
2. **Scaffold `wiki/`** — create the folder tree with `.gitkeep`s; seed empty
   `index.md` and `log.md` from their templates.
3. **Write `AGENTS.md`** — keeper persona (living organism that grows AND needs
   maintenance/repair), three-layer architecture + ownership rule, page
   templates for all 8 types, and the ingest / query / lint workflows (lint as a
   first-class maintenance duty).
4. **One real ingest** of a single book as an end-to-end test; adjust the schema
   based on what feels off.

## Non-goals (for now)

- Automation (launchd trigger, chained `claude -p`).
- Cloud fetch for app-made highlights.
- Migrating existing content (vault is currently empty — greenfield).
