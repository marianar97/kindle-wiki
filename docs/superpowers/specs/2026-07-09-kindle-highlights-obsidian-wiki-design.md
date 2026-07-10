# Kindle Highlights → Obsidian LLM Wiki

**Date:** 2026-07-09
**Status:** Draft — pending review (rev 2: local-first, My Clippings.txt source)

## Goal

Turn Kindle highlights into an Obsidian knowledge base that maintains itself:
per-book markdown files, an LLM-generated concept wiki linked via the Obsidian
graph, and an automated pipeline that keeps both current without manual work.

## Constraints discovered (2026-07-09 investigation)

- The Kindle Mac app (`com.amazon.Lassen`) stores only highlight **positions
  and colors** locally — not the text.
- The user highlights **mostly on a physical Kindle device**. The device's
  `My Clippings.txt` (at `/Volumes/Kindle/documents/My Clippings.txt` when
  mounted) records every clip made on the device, with text, page, location,
  and timestamp. This is the chosen source: fully local, no auth, no browser.
- Known gap, accepted for v1: `My Clippings.txt` only contains clips made on
  the device. Highlights made in the phone/Mac app live only in Amazon's
  cloud. A Playwright-based cloud fetcher was designed (see git history of
  this spec) and can be revived later as a second source.
- `My Clippings.txt` is append-only: it accumulates duplicates and keeps
  clips that were later deleted or edited on the device. The importer must
  dedupe exact duplicates; smarter overlap cleanup is deferred (see Out of
  scope).

## Architecture

Four components, each independently testable. Data flows one direction.

```
/Volumes/Kindle/documents/My Clippings.txt   (device plugged in via USB)
        │  1. importer (pure parser + dedupe)
        ▼
data/raw/<book-slug>.json      ← raw source of truth, regenerated per import
        │  2. renderer (pure function)
        ▼
vault/books/<book-slug>.md     ← machine-owned inside <highlights> block
        │  3. wiki builder (LLM via `claude -p`, merge-not-regenerate)
        ▼
vault/concepts/<concept>.md    ← concept pages linking [[books]] and quotes
        ▲
        └─ 4. trigger (launchd, fires on Kindle volume mount):
             import → render → wiki, loud failure
```

**Language:** Python for all scripts. Rationale: single-file scripts, no
build step, no dependencies beyond the standard library for import/render.

**Vault:** the project creates its own vault at `vault/` (open it in
Obsidian). Rationale: generated content stays isolated from the personal
"how to write" vault; merging later is a folder move.

### 1. Importer (`import_clippings.py`)

- Input: a copy of `My Clippings.txt` (the trigger copies it into
  `data/clippings/` with a timestamped name before parsing, so history is
  kept and parsing never touches the device).
- Parses the standard entry format:

  ```
  Title (Author)
  - Your Highlight on page 45 | location 680-682 | Added on Monday, January 1, 2024 11:11:11 PM

  The clipped text
  ==========
  ```

  Entry types: `Highlight`, `Note` (kept), `Bookmark` (skipped — no
  content). English-language device format assumed.
- Whole-file re-parse on every run (mirrors the "re-fetch the whole book"
  simplification): output JSON is regenerated from scratch, grouped by book.
- Dedupe: exact-duplicate clips (same book, type, location, text) collapse
  to one, keeping the latest timestamp.
- Stable clip IDs: `My Clippings.txt` has no native IDs, so the importer
  derives one — first 12 hex chars of SHA-1 over
  `title|type|location|text`. Deterministic across runs, survives
  re-imports, and gives the wiki stable anchors.
- Never partially write: render JSON to temp, rename on success.

Raw JSON schema per book (`data/raw/<book-slug>.json`):

```json
{
  "title": "Book Title",
  "author": "Author Name",
  "imported_at": "2026-07-09T12:00:00Z",
  "clips": [
    {
      "id": "a1b2c3d4e5f6",
      "type": "highlight",
      "text": "The highlighted passage.",
      "note": null,
      "page": 45,
      "location": "680-682",
      "date": "2024-01-01T23:11:11"
    }
  ]
}
```

Clip shape rules: for `type: "highlight"`, `text` is the highlighted passage
and `note` is an attached note when one immediately follows at the same
location, else null. For `type: "note"` (standalone note), `text` holds the
note content and `note` is null. `page` is null for books without real page
numbers.

### 2. Renderer (`render.py`)

Pure transform: `data/raw/*.json` → `vault/books/<book-slug>.md`.

File format:

```markdown
---
title: Book Title
author: Author Name
last_imported: 2026-07-09
---

# Book Title
*Author Name*

<highlights>

<!-- clip:start id=a1b2c3d4e5f6 type=highlight page=45 location=680-682 date=2024-01-01T23:11:11 -->
> The highlighted passage.

Note: My attached note (omitted when absent)
<!-- clip:end -->

</highlights>
```

- HTML comments mark clip boundaries and carry metadata: machine-parseable,
  invisible in Obsidian preview.
- Clips are ordered by location within the book.
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
  keeps the graph stable across runs and protects manual links.
- Concept pages are machine-owned inside a `<wiki>` block, same ownership
  rule as book files.
- Richer ontology (Entities, Themes, Quotes-as-nodes) is a later milestone,
  iterated only after v1 proves stable.

### 4. Trigger (`pipeline.py` + launchd)

- A launchd job watches for the Kindle volume mount (`StartOnMount` with a
  guard that checks `/Volumes/Kindle` exists). Plugging in the Kindle *is*
  the schedule: copy `My Clippings.txt` → import → render → wiki.
- Any step failing aborts the pipeline, logs to `data/logs/`, and fires a
  macOS notification (`osascript`). A success notification confirms the sync
  ran ("N new clips imported"), so silent staleness can't happen.

## Milestones (each ends in a demonstrable test)

1. **Import smoke test:** parse one clip from the real `My Clippings.txt`
   (device plugged in), verify text/page/location/date/id in JSON.
2. **Full import:** whole file → `data/raw/`, spot-check book and clip
   counts, verify dedupe.
3. **Renderer:** fixture JSON → golden-file markdown test; ownership rule
   verified (edits outside the block survive re-render).
4. **Wiki v1:** concepts generated for 2–3 books; second run with one new
   highlight reuses existing concept names (stability test).
5. **Automation:** launchd mount trigger runs end-to-end on plug-in;
   failure path verified (e.g., missing clippings file → notification).
6. **(Later) Wiki ontology iteration** — separate design pass once v1 is in
   daily use.

## Out of scope (for now)

- Cloud fetcher for phone/Mac-app highlights (revive from rev 1 of this
  spec if the gap starts to matter).
- Overlap cleanup: adjusting a highlight's edges on-device leaves both
  versions in the file as near-duplicates. v1 dedupes exact matches only;
  a containment heuristic is a later improvement.
- Obsidian plugin — filesystem writes are sufficient; Obsidian picks them up.
- Non-English device languages (clip headers are localized).
- Multi-vault or merging into the personal vault.

## Open questions

1. Confirm separate vault at `~/kindle-wiki/vault/` vs. a subfolder of the
   existing "how to write" vault.
