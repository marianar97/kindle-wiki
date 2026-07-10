# Kindle Highlights → Obsidian LLM Wiki

**Date:** 2026-07-09
**Status:** Draft — pending review

## Goal

Turn Kindle highlights into an Obsidian knowledge base that maintains itself:
per-book markdown files, an LLM-generated concept wiki linked via the Obsidian
graph, and a weekly pipeline that keeps both current without manual work.

## Constraints discovered (2026-07-09 investigation)

- The Kindle Mac app (`com.amazon.Lassen`) stores only highlight **positions
  and colors** locally — not the text. The source of truth is Amazon's cloud
  notebook at `read.amazon.com/notebook`.
- The cloud notebook exposes: highlight text, color, location, page (only for
  books with real page numbers), and attached notes. It does **not** expose
  timestamps. The clip schema therefore treats `page` and `date` as optional.
- Any fetch requires an authenticated Amazon session. Scripted login is off
  the table (credentials handling, captchas). Instead: a persistent browser
  profile where the user logs in manually once.

## Architecture

Four components, each independently testable. Data flows one direction.

```
[read.amazon.com/notebook]
        │  1. fetcher (Playwright, persistent profile)
        ▼
data/raw/<asin>.json          ← raw source of truth, append-only history not needed
        │  2. renderer (pure function, no network)
        ▼
vault/books/<title>.md        ← machine-owned inside <highlights> block
        │  3. wiki builder (LLM via `claude -p`, merge-not-regenerate)
        ▼
vault/concepts/<concept>.md   ← concept pages linking [[books]] and quotes
        ▲
        └─ 4. scheduler (launchd, weekly): fetch → render → wiki, loud failure
```

**Language:** Python + Playwright for fetcher/renderer/pipeline. Rationale:
single-file scripts, no build step, Playwright's `launch_persistent_context`
handles the login-once flow directly.

**Vault:** the project creates its own vault at `vault/` (open it in Obsidian).
Rationale: generated content stays isolated from the personal "how to write"
vault; merging later is a folder move.

### 1. Fetcher (`fetch.py`)

- Playwright with a persistent profile dir (`data/browser-profile/`). First
  run opens a headed window; user logs into Amazon manually; session persists
  for subsequent headless runs.
- Iterates every book in the notebook sidebar, extracts all clips, writes one
  JSON file per book. Whole-book re-fetch every time (no incremental logic).
- Captures Amazon's internal annotation IDs from day one — cheap now,
  impossible to backfill, needed later for stable quote links.
- On login wall or captcha: exit nonzero with a clear message. Never write
  partial JSON (write temp file, rename on success).

Raw JSON schema per book:

```json
{
  "asin": "B0FQGPMD79",
  "title": "Book Title",
  "author": "Author Name",
  "fetched_at": "2026-07-09T12:00:00Z",
  "clips": [
    {
      "id": "<amazon annotation id>",
      "type": "highlight",
      "text": "The highlighted passage.",
      "note": "My attached note, or null",
      "color": "yellow",
      "page": 45,
      "location": "680-682",
      "date": null
    }
  ]
}
```

Clip shape rules: for `type: "highlight"`, `text` is the highlighted passage
and `note` is the attached note or null. For `type: "note"` (standalone note
with no highlight), `text` holds the note content and `note` is null.

### 2. Renderer (`render.py`)

Pure transform: `data/raw/*.json` → `vault/books/<slugified title>.md`.

File format:

```markdown
---
title: Book Title
author: Author Name
asin: B0FQGPMD79
last_fetched: 2026-07-09
---

# Book Title
*Author Name*

<highlights>

<!-- clip:start id=abc123 type=highlight page=45 location=680-682 date= color=yellow -->
> The highlighted passage.

Note: My attached note (omitted when absent)
<!-- clip:end -->

</highlights>
```

- HTML comments mark clip boundaries and carry metadata: machine-parseable,
  invisible in Obsidian preview.
- **Ownership rule:** the renderer replaces only the content between
  `<highlights>` and `</highlights>`. Everything outside the block (user
  prose above or below) is preserved verbatim. New files get the full
  skeleton.
- Never partially write: render to temp, rename.

### 3. Wiki builder (`wiki.py`)

- v1 ontology is deliberately minimal: **Books** and **Concepts** only.
  One page per concept in `vault/concepts/`, listing quotes (with `[[book]]`
  links) that support it. The Obsidian graph emerges from the wikilinks —
  no plugin required.
- LLM invoked headlessly via `claude -p` (reuses existing Claude Code auth;
  no API key management).
- **Merge, don't regenerate:** every run passes the LLM the existing concept
  index (filenames + one-line summaries) and instructs it to reuse existing
  concept names, creating new pages only for genuinely new concepts. This
  keeps the graph stable across weekly runs and protects manual links.
- Concept pages are machine-owned inside a `<wiki>` block, same ownership
  rule as book files.
- Richer ontology (Entities, Themes, Quotes-as-nodes) is a later milestone,
  iterated only after v1 proves stable.

### 4. Scheduler (`pipeline.py` + launchd)

- One weekly launchd job runs `pipeline.py`: fetch → render → wiki.
- Any step failing aborts the pipeline, logs to `data/logs/`, and fires a
  macOS notification (`osascript`) saying what to do (usually: re-login).
  Silent staleness is the failure mode to avoid.

## Milestones (each ends in a demonstrable test)

1. **Fetch smoke test:** fetch a single book, verify one highlight lands in
   JSON with correct text/color/location/id. (The "one highlight" trial.)
2. **Full fetch:** all books → `data/raw/`, spot-check counts against the
   notebook UI.
3. **Renderer:** fixture JSON → golden-file markdown test; ownership rule
   verified (edits outside the block survive re-render).
4. **Wiki v1:** concepts generated for 2–3 books; second run with one new
   highlight reuses existing concept names (stability test).
5. **Automation:** launchd job runs end-to-end; failure path verified by
   running with a logged-out profile and confirming the notification fires.
6. **(Later) Wiki ontology iteration** — separate design pass once v1 is in
   daily use.

## Out of scope (for now)

- Physical-device `My Clippings.txt` parsing (open question below).
- Obsidian plugin — filesystem writes are sufficient; Obsidian picks them up.
- Incremental per-highlight sync/dedup — whole-book re-fetch is fine at this
  scale.
- Multi-vault or merging into the personal vault.

## Open questions

1. Do you own a physical Kindle device? If yes and timestamps matter, a
   `My Clippings.txt` importer becomes a worthwhile milestone (it is the only
   source that has dates).
2. Confirm separate vault at `~/kindle-wiki/vault/` vs. a subfolder of the
   existing "how to write" vault.
