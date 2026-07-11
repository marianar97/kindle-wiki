// Parsers for read.amazon.com/notebook markup. Pure functions: HTML in,
// data out. Selectors verified against the live DOM on 2026-07-10.

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function parseDoc(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

export function parseLibrary(html) {
  const doc = parseDoc(html);
  const books = [];
  for (const el of doc.querySelectorAll("#kp-notebook-library .kp-notebook-library-each-book")) {
    const title = clean(el.querySelector("h2")?.textContent);
    if (!el.id || !title) continue;
    const author = clean(el.querySelector("p")?.textContent).replace(/^by:?\s*/i, "");
    books.push({ asin: el.id, title, author: author || null });
  }
  return books;
}

function parseHeader(row) {
  const header = clean(row.querySelector("#annotationHighlightHeader")?.textContent);
  const color = header.match(/^([a-z]+) highlight/i)?.[1]?.toLowerCase() ?? null;
  const headerLocation = header.match(/location:\s*([\d,–-]+)/i)?.[1]?.replace(/,/g, "") ?? null;
  return { color, headerLocation };
}

export function parseAnnotations(html) {
  const doc = parseDoc(html);
  const clips = [];
  for (const row of doc.querySelectorAll("#kp-notebook-annotations .a-row.a-spacing-base")) {
    const text = clean(row.querySelector("#highlight")?.textContent);
    const note = clean(row.querySelector("#note")?.textContent);
    if (!text && !note) continue;
    const { color, headerLocation } = parseHeader(row);
    const location = clean(row.querySelector("#kp-annotation-location")?.value) || headerLocation;
    if (text) clips.push({ type: "highlight", text, location, color });
    if (note) clips.push({ type: "note", text: note, location, color: null });
  }
  return {
    clips,
    nextToken: doc.querySelector(".kp-notebook-annotations-next-page-start")?.value || null,
    limitState: doc.querySelector(".kp-notebook-content-limit-state")?.value ?? "",
  };
}

export function isLoginHtml(html) {
  return /action="[^"]*\/ap\/signin|name="signIn"/i.test(html);
}

const NOTEBOOK_URL = "https://read.amazon.com/notebook";

export class LoginRequiredError extends Error {
  constructor() {
    super("Not logged in to read.amazon.com");
    this.name = "LoginRequiredError";
  }
}

async function fetchNotebookHtml(url, fetchFn) {
  const res = await fetchFn(url, { credentials: "include" });
  if (res.redirected && /\/ap\/signin/.test(res.url)) throw new LoginRequiredError();
  if (!res.ok) throw new Error(`Amazon returned HTTP ${res.status} for ${url}`);
  const html = await res.text();
  if (isLoginHtml(html)) throw new LoginRequiredError();
  return html;
}

export async function fetchLibrary({ fetchFn = fetch } = {}) {
  return parseLibrary(await fetchNotebookHtml(NOTEBOOK_URL, fetchFn));
}

export async function fetchBookClips(asin, { fetchFn = fetch } = {}) {
  let url = `${NOTEBOOK_URL}?asin=${encodeURIComponent(asin)}&contentLimitState=&`;
  const clips = [];
  for (;;) {
    const page = parseAnnotations(await fetchNotebookHtml(url, fetchFn));
    clips.push(...page.clips);
    if (!page.nextToken) return clips;
    url =
      `${NOTEBOOK_URL}?asin=${encodeURIComponent(asin)}` +
      `&token=${encodeURIComponent(page.nextToken)}` +
      `&contentLimitState=${encodeURIComponent(page.limitState)}`;
  }
}
