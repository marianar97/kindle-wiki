# Building an LLM Wiki from Kindle Highlights

## Problem

**Knowledge decay.** I read books continuously but without highlighting or note-taking. Ideas stay top-of-mind for roughly a month after finishing a book, then fade. Without any recall mechanism or active engagement, the concepts I found valuable are lost.

**No interrelation.** My reading spans genres — sci-fi to economics — and part of the value of reading broadly is connecting ideas across domains. Today I have no way to capture _which_ concepts resonated, _why_ they resonated, or *how* they relate to ideas from other books.

## Solution

I am building a Kindle [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): a system that combines:

- **Kindle highlights** as the raw capture layer
- **Obsidian** as the local knowledge store
- **An LLM agent** as the curator that turns highlights into linked notes

I use the [Obsidian Kindle Plugin](https://github.com/hadynz/obsidian-kindle-plugin) to import highlights. The imported files remain unchanged so that every interpretation can point back to its source.

The LLM does not replace the source material. It creates a structured layer over it: source notes, concepts, people, entities, and themes connected with wikilinks.

## Architecture

```text
kindle-wiki/
├── AGENTS.md
└── vault/
    ├── raw/
    │   └── books/
    └── wiki/
        ├── books/
        ├── concepts/
        ├── entities/
        ├── people/
        ├── source-notes/
        ├── themes/
        ├── index.md
        └── log.md
```

- `raw/books/` is machine-owned source material. 
- `wiki/` contains LLM-written pages.
- `AGENTS.md` defines the ontology, templates, linking rules, and ingestion workflow.

## A light ontology

I want enough structure to make the graph useful without trying to model every possible relationship.

The core entities are:

- **Book** — one page per book
- **Person** — anyone who authors a book or appears in one
- **Concept** — an idea developed across one or more sources
- **Entity** — an organization, place, work, or event
- **Theme** — a broad research area that groups concepts

A **Source Note** is the evidence layer. Each source note represents one anchored Kindle highlight and connects it to the rest of the graph.

## Typed relationships

A wikilink proves that two pages are connected, but it does not explain the connection. Typed frontmatter properties give each link a defined meaning.

**Book** authors:

```yaml
---
title: "The Infinity Machine"
type: book
authors:
  - "[[sebastian-mallaby|Sebastian Mallaby]]"
year: 2022
genres:
  - Business
book-slug: Mallaby-The Infinity Machine
---
```

A source note records its book and the things supported or mentioned by the highlight:

```yaml
---
title: "Building Intelligence to Study Mind"
type: highlight
book: "[[the-infinity-machine-sebastian-mallaby|The Infinity Machine]]"
book-slug: Mallaby-The Infinity Machine
ref: ^ref-123
concepts:
  - "[[intelligence|Intelligence]]"
people:
  - "[[demis-hassabis|Demis Hassabis]]"
entities:
  - "[[deepmind|DeepMind]]"
---
```

A theme explicitly groups concepts:

```yaml
---
name: "Intelligence and Mind"
type: theme
concepts:
  - "[[intelligence|Intelligence]]"
  - "[[emergent-intelligence|Emergent Intelligence]]"
---
```

The schema uses domain-appropriate labels: people, concepts, entities, and themes have a `name`; books and source notes have a `title`.

## Canonical, curated, and derived links

Not every useful connection should be stored directly.

**Canonical relationships** record source facts:

- A Book has one or more authors, each pointing to a Person.
- A Source Note belongs to exactly one Book.
- A Source Note can discuss Concepts and mention People or Entities.
- A Theme groups Concepts.

**Curated relationships** express an interpreted connection. For example, a concept page may identify a Person as a key thinker only when the sources establish a substantive position. The page should explain the position rather than relying on a vague link.

**Derived relationships** are calculated from canonical links. A Book discusses the Concepts linked by its Source Notes. A Person's authored books are the inverse of the authors listed on Book pages. Storing these relationships in both directions would make navigation slightly easier, but it would also create data that can drift out of sync.

The existing `related` property remains a navigation aid. It is not treated as a formal ontology predicate.

## The ingestion process

When new highlights arrive, the agent:

1. Reads the imported book without modifying it.
2. Creates one Source Note per anchored highlight.
3. Links each Source Note to its Book, Concepts, People, and Entities.
4. Creates or updates the corresponding ontology pages.
5. Updates themes, the index, and the append-only activity log.
6. Checks for broken links, duplicate pages, missing targets, and stale relationships.

This process turns a highlight into a traceable path:

```text
Book ← Source Note → Concept ← Theme
         │
         ├──→ Person
         └──→ Entity
```

## Keeping the syntax correct

The ontology is currently an evolving design. The next step is a validator that goes beyond checking whether a wikilink resolves. It should also verify:

- The page type matches its folder.
- Required frontmatter fields exist.
- Relationship targets exist.
- Every target has an allowed type.
- Cardinality rules hold, such as one Book per Source Note.
- Aliases do not create duplicate canonical pages.
- Raw highlight references still resolve.

The goal is not to build a universal knowledge model. It is to preserve what I learn from books, connect ideas across domains, and make every interpretation traceable to the passage that produced it.
