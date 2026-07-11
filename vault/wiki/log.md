# Log

Append-only record of the agent's actions on the wiki. Newest entries at the
bottom. Never edit or delete past entries. Entry formats:

- `## [YYYY-MM-DD] ingest | <source title> | <author, year>` followed by a list
  of pages created and updated.
- `## [YYYY-MM-DD] page needed | <page name>` — a stub was created that needs
  fuller treatment.
- `## [YYYY-MM-DD] gap identified | <what is missing>` — a query surfaced a hole.
- `## [YYYY-MM-DD] lint | <summary>` — a lint pass and what it found.
