// Orchestrates a full sync: library -> per-book clips -> render -> write.
// Dependencies are injected so tests can fake the network and filesystem.

import { assignIds, dedupe, renderBook, slugify, sortClips } from "./renderer.js";

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function uniqueSlug(title, author, used) {
  let slug = slugify(title);
  if (used.has(slug)) {
    const base = `${slug}-${slugify(author || "unknown")}`;
    slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n++}`;
    }
  }
  used.add(slug);
  return slug;
}

export async function runSync(deps, vaultHandle, onProgress) {
  const { fetchLibrary, fetchBookClips, writeBook, archiveSnapshot } = deps;
  const syncedOn = today();
  const books = await fetchLibrary();
  onProgress({ kind: "library", count: books.length });

  const summary = { books: books.length, booksWritten: 0, newClips: 0, failures: [] };
  const snapshot = { exported: new Date().toISOString(), books: [] };
  const usedSlugs = new Set();

  for (const book of books) {
    onProgress({ kind: "book-start", title: book.title });
    try {
      const rawClips = await fetchBookClips(book.asin);
      snapshot.books.push({ ...book, clips: rawClips });
      if (rawClips.length === 0) {
        onProgress({ kind: "book-done", title: book.title, clips: 0, written: false });
        continue;
      }
      const clips = sortClips(
        dedupe(
          await assignIds(
            rawClips.map((c) => ({ ...c, title: book.title, author: book.author }))
          )
        )
      );
      const slug = uniqueSlug(book.title, book.author, usedSlugs);
      const content = renderBook(book.title, book.author, clips, syncedOn);
      const result = await writeBook(vaultHandle, slug, content, clips);
      if (result.written) summary.booksWritten += 1;
      summary.newClips += result.newClips;
      onProgress({ kind: "book-done", title: book.title, clips: clips.length, written: result.written });
    } catch (err) {
      if (!snapshot.books.some((b) => b.asin === book.asin)) {
        snapshot.books.push({ ...book, clips: [], error: err.message });
      }
      summary.failures.push({ title: book.title, error: err.message });
      onProgress({ kind: "book-failed", title: book.title, error: err.message });
    }
  }

  await archiveSnapshot(vaultHandle, snapshot);
  onProgress({ kind: "done", summary });
  return summary;
}
