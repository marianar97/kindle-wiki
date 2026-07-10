# kindle-wiki

Kindle highlights → Obsidian LLM wiki. `sync.py` generates `vault/books/*.md`
from the Kindle's My Clippings.txt. You (the agent) maintain the wiki in
`vault/concepts/` using the operations below. Open `vault/` in Obsidian to
see the graph.

## Layout

- `vault/books/` — GENERATED sources. Never edit these; sync.py overwrites
  them wholesale.
- `vault/concepts/` — the wiki. You create and update these pages.
- `vault/concepts/_index.md` — concept list plus per-book ingest record.

## Book file format

Each clip block ends with a block ID (for example `^3f9c2a1b7d04`).
Highlights are blockquotes with a metadata line; notes are `Note:`
paragraphs; bookmarks are single metadata lines. Frontmatter carries
`title`, `author`, and `last_synced`.

## Concept pages

`vault/concepts/<Concept Name>.md`:

```markdown
---
summary: One sentence stating the concept.
---

# <Concept Name>

One short paragraph explaining the concept in your own words.

## Quotes

![[peak#^3f9c2a1b7d04]]

## Related

- [[Other Concept]] — one line on the relationship.
```

Rules:
- Embed quotes with `![[book-slug#^id]]`. Never copy quote text into a
  concept page — the book file is the single source of truth.
- Link books and other concepts with wikilinks; the Obsidian graph is built
  from these links.
- Concept names: short noun phrases, Title Case, singular ("Feedback Loop",
  not "feedback loops").

## _index.md format

```markdown
# Index

## Concepts

- [[Deliberate Practice]] — focused, feedback-driven practice at the edge
  of ability.

## Ingest record

- peak — last ingested 2026-07-09
```

## Operations

### Ingest ("ingest", "ingest new highlights")

1. Read `vault/concepts/_index.md` (create it from the format above if
   missing). For each file in `vault/books/`, compare its `last_synced`
   frontmatter to the ingest record; collect books that are new or newer.
2. For each collected book, read its highlights and notes. Skip bookmarks —
   they carry no text to cite.
3. Assign each clip to 1–3 concepts. STRONGLY prefer existing concept names
   from the index; create a new concept page only when nothing fits. Never
   create a near-synonym of an existing concept.
4. Update concept pages: add embeds under `## Quotes`, keep the summary
   paragraph current, maintain `## Related` links.
5. Update `_index.md` last: add new concepts to the list, set each ingested
   book's record to its `last_synced` date.
6. Report: books ingested, clips assigned, concepts touched, concepts
   created.

### Lint ("lint", "lint the wiki")

1. Near-duplicate concepts (synonyms, singular/plural, overlapping scope):
   report pairs with a proposed merge direction. Do NOT merge without the
   user's approval.
2. Broken embeds: `![[book#^id]]` targets that no longer exist in
   `vault/books/`. Report each.
3. Orphan pages: concept pages missing from `_index.md` or with zero quotes.
4. Index drift: `_index.md` entries whose page is missing, or pages absent
   from the index. Fix drift directly (it is mechanical); report everything
   else.

## Constraints

- Never edit `vault/books/` or `sync.py` during ingest/lint.
- No emojis anywhere.
- Keep concept pages short: summary, one paragraph, quotes, related links.
