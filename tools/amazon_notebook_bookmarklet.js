// Kindle notebook exporter bookmarklet (readable source).
//
// Usage: open https://read.amazon.com/notebook, click a book so its
// highlights are visible, then click the bookmarklet. It downloads a JSON
// file matching import_amazon.py's contract:
//   {title, author, highlights: [{text, location, page, note}]}
// Then run: python3 import_amazon.py ~/Downloads/<file>.json
//
// The minified one-liner to paste into a bookmark's URL field is in
// amazon_notebook_bookmarklet.min.txt (regenerate it from this file if the
// logic changes). Selectors verified against the live notebook DOM on
// 2026-07-10; if Amazon redesigns the page, fix them here first.
javascript: (() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const title = clean(document.querySelector("h3.kp-notebook-metadata")?.textContent);
  if (!title) {
    alert("Open a book in read.amazon.com/notebook first.");
    return;
  }

  const metaLines = [...document.querySelectorAll("p.kp-notebook-metadata")]
    .map((e) => clean(e.textContent));
  const author = metaLines.find((t) => t && !/^your kindle notes for:$/i.test(t)) || null;

  const rows = [...document.querySelectorAll("#kp-notebook-annotations .a-row.a-spacing-base")];
  const highlights = [];
  for (const row of rows) {
    const text = clean(row.querySelector("#highlight")?.textContent);
    const note = clean(row.querySelector("#note")?.textContent);
    if (!text && !note) continue;
    const location = clean(row.querySelector("#kp-annotation-location")?.value) || null;
    const header = clean(row.querySelector("#annotationHighlightHeader")?.textContent);
    const pageMatch = header.match(/page:\s*([^|]+)/i);
    highlights.push({
      text: text || null,
      location,
      page: pageMatch ? clean(pageMatch[1]) : null,
      note: note || null,
    });
  }

  // Amazon lazy-loads long books; a non-empty token means more rows exist.
  const pending = document.querySelector(".kp-notebook-annotations-next-page-start")?.value;
  if (pending) {
    alert("Not all highlights are loaded yet. Scroll to the bottom of the highlight list, then click the bookmarklet again.");
    return;
  }

  const payload = {
    title,
    author,
    asin: document.querySelector("#kp-notebook-annotations-asin")?.value || null,
    exported: new Date().toISOString(),
    highlights,
  };

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug || "kindle"}-kindle-export.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  alert(`Exported ${highlights.length} annotations from "${title}".`);
})();
