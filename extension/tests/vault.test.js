import { describe, expect, it } from "vitest";
import { stripVolatile, shouldWrite, countNewClips, snapshotName } from "../src/vault.js";

const OLD = `---
title: "T"
author: null
last_synced: 2026-07-01
---
body ^aaaaaaaaaaaa
`;

describe("shouldWrite", () => {
  it("skips when only last_synced differs", () => {
    const next = OLD.replace("2026-07-01", "2026-07-10");
    expect(shouldWrite(OLD, next)).toBe(false);
  });
  it("writes when content differs", () => {
    expect(shouldWrite(OLD, OLD.replace("body", "new body"))).toBe(true);
  });
  it("writes when the file is new", () => {
    expect(shouldWrite(null, OLD)).toBe(true);
  });
});

describe("stripVolatile", () => {
  it("blanks the last_synced value only", () => {
    expect(stripVolatile(OLD)).toContain("last_synced:\n");
    expect(stripVolatile(OLD)).toContain('title: "T"');
  });
});

describe("countNewClips", () => {
  it("counts ids absent from the old content", () => {
    const clips = [{ id: "aaaaaaaaaaaa" }, { id: "bbbbbbbbbbbb" }];
    expect(countNewClips(OLD, clips)).toBe(1);
    expect(countNewClips(null, clips)).toBe(2);
  });
});

describe("snapshotName", () => {
  it("formats the timestamped filename", () => {
    const date = new Date(2026, 6, 10, 20, 14, 46);
    expect(snapshotName(date)).toBe("2026-07-10-201446-amazon-notebook.json");
  });
});
