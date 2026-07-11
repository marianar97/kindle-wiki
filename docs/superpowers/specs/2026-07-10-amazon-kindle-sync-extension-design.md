# Amazon Kindle Sync — Chrome Extension Design

Date: 2026-07-10
Status: approved design, pre-implementation

## Problem

Highlights currently reach `vault/raw/` through a manual pipeline: a bookmarklet
scrapes one book at a time from read.amazon.com/notebook into a JSON download,
then `import_amazon.py` renders it into `vault/raw/books/*.md`. This requires
opening each book, scrolling to force lazy loading, downloading a file, and
running a terminal command.

All of Mariana's highlights come from Amazon-purchased books (no sideloaded
content), so the Kindle-USB path (`sync.py` reading `My Clippings.txt`) is no
longer needed as a separate source.

## Goal

One click in Chrome syncs the **entire Amazon library** — every book, every
highlight and note — directly into the Obsidian vault at `vault/raw/`, with no
terminal step. The extension becomes the **sole writer** of `vault/raw/`; the
Python scripts and the bookmarklet retire.

## Decisions made during brainstorming

- **Capture scope:** always sweep the whole library. Dedupe and
  skip-unchanged-files make re-runs cheap.
- **Writer:** the extension writes markdown itself (File System Access API).
  No native messaging, no Python.
- **Format compatibility:** the extension reproduces `sync.py`'s output
  byte-for-byte — same block IDs,   same slugs, same markdown layout — so existing `![[slug#^id]]` embeds keep
  resolving and re-syncs don't churn files (one exception: the generated-file
  comment line changes once; see renderer section).
- **UI:** full-page extension tab (not a popup), styled after Obsidian's
  dark theme.

## Architecture

Manifest V3 extension living in `extension/` in this repo, loaded unpacked.

```
extension/
  manifest.json          MV3; host_permissions: https://read.amazon.com/*
  src/
    scraper.js           fetch + parse Amazon notebook endpoints (pure parsers)
    renderer.js          port of sync.py: ids, slugs, dedupe, markdown render
    vault.js             File System Access writes; handle persistence
    sync-page.html/css/js  the UI tab
  tests/                 Vitest: parser fixtures + renderer golden files
  package.json           dev deps (vitest)
  README.md              load-unpacked install + usage
```

Clicking the toolbar icon opens (or focuses) the sync page as a tab.

### Component: scraper

Fetches the same internal endpoints the notebook page itself uses:

1. Library list — the notebook sidebar markup, yielding `{asin, title,
   author}` per book.
2. Per book, the annotations view for that ASIN, looping the pagination
   token (`.kp-notebook-annotations-next-page-start`) until empty.

Responses are HTML fragments parsed with `DOMParser` using the selectors
already verified against the live DOM on 2026-07-10 (`#highlight`, `#note`,
`#kp-annotation-location`, `#annotationHighlightHeader`,
`h3.kp-notebook-metadata`). Parsing functions are pure (HTML string in,
data out) so they are unit-testable without a browser session.

Login detection: if a response is a sign-in page or a redirect, the sync
stops with a "Log in to Amazon first" message linking to the notebook.

**Fallback (only if needed):** if extension-context fetches fail on cookies
or bot detection, run the identical fetch loop from a content script inside a
logged-in read.amazon.com tab. Same parsers, same everything downstream; the
user just needs that tab open.

### Component: renderer

Direct port of `sync.py` semantics:

- **Clip:** `{title, author, type: highlight|note, page, location, text}`.
  (Bookmarks don't appear on the notebook page; the `bookmark` render branch
  is not ported.)
- **Block ID:** first 12 hex chars of `sha1("title|type|location|text")`
  via `crypto.subtle.digest`.
- **Dedupe:** by ID, first occurrence wins (no dates on notebook data).
- **Ordering:** by numeric location start, then type rank
  (highlight before note).
- **Slug:** lowercase, non-alphanumeric runs to `-`, trimmed; collision gets
  `-<author-slug>` suffix.
- **File:** frontmatter (`title`, `author`, `last_synced`), generated-file
  comment, `# Title`, `*Author*`, `## Highlights`, clips separated by blank
  lines. Highlights render as blockquotes with a `— highlight · loc. N ^id`
  meta line; notes as `Note: ... ^id`.
- The generated-file comment updates to name the extension instead of
  `sync.py`. This causes a **one-time rewrite** of every book file on the
  first extension sync (comment line only — IDs, slugs, and quote text are
  unchanged, so embeds are unaffected).

Renderer output is validated by golden-file tests: fixtures generated from
the current Python code against real vault data **before** the Python is
deleted, asserted byte-for-byte (modulo the volatile `last_synced` value and
the generated-comment text).

### Component: vault writer

- First run: `showDirectoryPicker()` for the `vault/` folder; the
  `FileSystemDirectoryHandle` persists in IndexedDB.
- Later sessions: `queryPermission`/`requestPermission` on the stored handle
  (one click on the sync button satisfies the user-gesture requirement).
- Writes:
  - `raw/books/<slug>.md` — skipped when content is unchanged ignoring the
    `last_synced` line, mirroring `write_vault`.
  - `raw/clippings/<timestamp>-amazon-notebook.json` — full-library snapshot
    (`{"books": [...]}` shape) per sync, preserving the audit trail.
- Never deletes anything. A book absent from Amazon's list is left alone.

### UI

Obsidian-inspired: dark background, Obsidian purple accent, clean sans
typography, generous spacing. Three states:

1. **Setup** — single "Choose vault folder" card with a one-line explanation.
2. **Ready** — primary "Sync highlights" button; quiet status line with the
   connected vault name and last sync time (stored in `chrome.storage.local`).
3. **Syncing** — live book-by-book progress list ("The Infinity Machine — 34
   highlights ✓"), then a summary: "12 new clips across 3 books · JSON
   snapshot archived". Failed books show inline with the error, and the rest
   of the sync continues.

## Error handling

- **Not logged in** → actionable message + link, sync aborted cleanly.
- **One book fails to parse** → reported inline, remaining books continue,
  summary counts failures.
- **Folder permission lost** → re-request on next click; if the folder is
  gone, fall back to setup state.
- **Amazon markup change** → parse errors surface per book with enough detail
  to fix selectors in `scraper.js`.

## Testing

- Vitest, run from `extension/`.
- Parser tests: saved HTML fixtures for the library list and an annotations
  page (with and without a pagination token, with notes, with page numbers).
- Renderer golden tests: JS output vs Python-generated fixtures for real
  books from the vault, byte-for-byte.
- Vault writer's skip-unchanged logic tested against in-memory content pairs.
- End-to-end (manual): run against the real library, then `git diff vault/raw`
  on books already imported via the old pipeline must show only the
  generated-comment line and `last_synced` — no changes to quotes, meta
  lines, or block IDs.

## Cleanup (after end-to-end verification)

- Delete `sync.py`, `import_amazon.py`, `tests/test_import_amazon.py`, other
  sync tests, and `tools/amazon_notebook_bookmarklet.{js,min.txt}`.
- Update `AGENTS.md`: `raw/` is generated by the extension; drop references
  to `sync.py` (including the "never edit sync.py" ground rule, which becomes
  "never edit the extension's renderer during ingest/lint/query").

## Out of scope

- Publishing to the Chrome Web Store (load unpacked only).
- Scheduled/background auto-sync (sync is a deliberate click).
- Book-picker UI (whole-library sweep only).
- Syncing anything other than highlights and notes.
