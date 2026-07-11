// Port of sync.py's rendering semantics. Block IDs must stay byte-compatible:
// sha1("title|type|location|text") truncated to 12 hex chars, where a missing
// location renders as "None" exactly like Python's f-string did.

export async function clipId(clip) {
  const key = `${clip.title}|${clip.type}|${clip.location ?? "None"}|${clip.text}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}
