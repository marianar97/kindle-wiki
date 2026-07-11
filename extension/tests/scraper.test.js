// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseLibrary, parseAnnotations, isLoginHtml } from "../src/scraper.js";

const LIBRARY_HTML = `
<div id="kp-notebook-library">
  <div class="kp-notebook-library-each-book a-row" id="B0FQGPMD79">
    <a class="a-link-normal">
      <h2 class="kp-notebook-searchable a-text-bold">The Infinity Machine</h2>
      <p class="kp-notebook-searchable">By: Sebastian Mallaby</p>
    </a>
  </div>
  <div class="kp-notebook-library-each-book a-row" id="B000000001">
    <a class="a-link-normal">
      <h2 class="kp-notebook-searchable a-text-bold">Untitled Draft</h2>
      <p class="kp-notebook-searchable"></p>
    </a>
  </div>
</div>`;

const ANNOTATIONS_HTML = `
<div id="kp-notebook-annotations-pane">
  <input type="hidden" class="kp-notebook-annotations-next-page-start" value="">
  <input type="hidden" class="kp-notebook-content-limit-state" value="">
  <div id="kp-notebook-annotations">
    <div class="a-row a-spacing-base">
      <input type="hidden" id="kp-annotation-location" value="102">
      <span id="annotationHighlightHeader" class="a-size-small">Orange highlight | Location: 102</span>
      <div id="highlight-container"><span id="highlight">First highlight text.</span></div>
      <div id="note-container"><span id="note"></span></div>
    </div>
    <div class="a-row a-spacing-base">
      <input type="hidden" id="kp-annotation-location" value="3557">
      <span id="annotationHighlightHeader" class="a-size-small">Blue highlight | Location: 3,557</span>
      <div id="highlight-container"><span id="highlight">Second   highlight
        with messy whitespace.</span></div>
      <div id="note-container"><span id="note">A note on the highlight.</span></div>
    </div>
    <div class="a-row a-spacing-base">
      <div id="highlight-container"><span id="highlight"></span></div>
      <div id="note-container"><span id="note"></span></div>
    </div>
  </div>
</div>`;

const PAGINATED_HTML = ANNOTATIONS_HTML.replace(
  'class="kp-notebook-annotations-next-page-start" value=""',
  'class="kp-notebook-annotations-next-page-start" value="TOKEN123"'
).replace(
  'class="kp-notebook-content-limit-state" value=""',
  'class="kp-notebook-content-limit-state" value="STATE456"'
);

describe("parseLibrary", () => {
  it("extracts asin, title, author", () => {
    const books = parseLibrary(LIBRARY_HTML);
    expect(books).toEqual([
      { asin: "B0FQGPMD79", title: "The Infinity Machine", author: "Sebastian Mallaby" },
      { asin: "B000000001", title: "Untitled Draft", author: null },
    ]);
  });
});

describe("parseAnnotations", () => {
  it("extracts highlights, notes, colors, locations", () => {
    const page = parseAnnotations(ANNOTATIONS_HTML);
    expect(page.clips).toEqual([
      { type: "highlight", text: "First highlight text.", location: "102", color: "orange" },
      { type: "highlight", text: "Second highlight with messy whitespace.", location: "3557", color: "blue" },
      { type: "note", text: "A note on the highlight.", location: "3557", color: null },
    ]);
    expect(page.nextToken).toBeNull();
  });

  it("surfaces the pagination token and limit state", () => {
    const page = parseAnnotations(PAGINATED_HTML);
    expect(page.nextToken).toBe("TOKEN123");
    expect(page.limitState).toBe("STATE456");
  });
});

describe("isLoginHtml", () => {
  it("detects the Amazon sign-in page", () => {
    expect(isLoginHtml('<form name="signIn" action="/ap/signin">')).toBe(true);
    expect(isLoginHtml(ANNOTATIONS_HTML)).toBe(false);
  });
});
