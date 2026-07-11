import { describe, expect, it, vi } from "vitest";
import { runSync } from "../src/sync.js";

const BOOKS = [
  { asin: "A1", title: "Book One", author: "Alice" },
  { asin: "A2", title: "Book Two", author: null },
];

const CLIPS_A1 = [
  { type: "highlight", text: "hello", location: "10", color: "yellow" },
];

function deps(overrides = {}) {
  return {
    fetchLibrary: vi.fn(async () => BOOKS),
    fetchBookClips: vi.fn(async (asin) => (asin === "A1" ? CLIPS_A1 : [])),
    writeBook: vi.fn(async () => ({ written: true, newClips: 1 })),
    archiveSnapshot: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runSync", () => {
  it("scrapes every book, writes files, archives a snapshot", async () => {
    const d = deps();
    const events = [];
    const summary = await runSync(d, "vault-handle", (e) => events.push(e));

    expect(d.fetchBookClips).toHaveBeenCalledTimes(2);
    // Book Two has zero clips -> no file written for it
    expect(d.writeBook).toHaveBeenCalledTimes(1);
    const [vault, slug, content, clips] = d.writeBook.mock.calls[0];
    expect(vault).toBe("vault-handle");
    expect(slug).toBe("book-one");
    expect(content).toContain("^");
    expect(clips[0].id).toMatch(/^[0-9a-f]{12}$/);

    expect(d.archiveSnapshot).toHaveBeenCalledOnce();
    const payload = d.archiveSnapshot.mock.calls[0][1];
    expect(payload.books).toHaveLength(2);
    expect(payload.books[0]).toMatchObject({ asin: "A1", title: "Book One" });

    expect(summary).toMatchObject({ books: 2, booksWritten: 1, newClips: 1, failures: [] });
    expect(events.some((e) => e.kind === "book-done" && e.title === "Book One")).toBe(true);
  });

  it("continues past a failing book and reports it", async () => {
    const d = deps({
      fetchBookClips: vi.fn(async (asin) => {
        if (asin === "A1") throw new Error("parse exploded");
        return CLIPS_A1;
      }),
    });
    const summary = await runSync(d, "vault-handle", () => {});
    expect(summary.failures).toEqual([{ title: "Book One", error: "parse exploded" }]);
    expect(d.writeBook).toHaveBeenCalledTimes(1); // Book Two still written
  });

  it("suffixes the slug when two books collide", async () => {
    const d = deps({
      fetchLibrary: vi.fn(async () => [
        { asin: "A1", title: "Same Title", author: "Alice" },
        { asin: "A2", title: "Same Title!", author: "Bob" },
      ]),
      fetchBookClips: vi.fn(async () => CLIPS_A1),
    });
    await runSync(d, "vault-handle", () => {});
    const slugs = d.writeBook.mock.calls.map((c) => c[1]);
    expect(slugs).toEqual(["same-title", "same-title-bob"]);
  });
});
