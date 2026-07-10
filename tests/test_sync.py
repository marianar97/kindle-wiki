from datetime import datetime

from sync import Clip, parse_clippings

HIGHLIGHT_ENTRY = """Peak (Anders Ericsson)
- Your Highlight on page 45 | location 680-682 | Added on Monday, June 1, 2026 9:12:44 PM

The right sort of practice carried out over a sufficient period of time leads to improvement.
==========
"""


def test_parse_single_highlight():
    clips = parse_clippings(HIGHLIGHT_ENTRY)
    assert len(clips) == 1
    clip = clips[0]
    assert clip.title == "Peak"
    assert clip.author == "Anders Ericsson"
    assert clip.type == "highlight"
    assert clip.page == "45"
    assert clip.location == "680-682"
    assert clip.date == datetime(2026, 6, 1, 21, 12, 44)
    assert clip.text == (
        "The right sort of practice carried out over a sufficient "
        "period of time leads to improvement."
    )


VARIANT_ENTRIES = "﻿" + """Peak (Anders Ericsson)
- Your Note on page 45 | location 681 | Added on Monday, June 1, 2026 9:13:02 PM

Connect this to the coaching project.
==========
Peak (Anders Ericsson)
- Your Bookmark on page 51 | location 760 | Added on Tuesday, June 2, 2026 8:03:10 AM

==========
Meditations
- Your Highlight at location 120-121 | Added on Wednesday, June 3, 2026 7:15:00 AM

You have power over your mind - not outside events.
==========
Some Report (Institute)
- Your Highlight on page ix | location 12 | Added on BADLY FORMED DATE

Front matter quote.
==========
"""


def test_parse_note_entry():
    clips = parse_clippings(VARIANT_ENTRIES)
    note = clips[0]
    assert note.title == "Peak"
    assert note.type == "note"
    assert note.location == "681"
    assert note.text == "Connect this to the coaching project."


def test_parse_bookmark_entry_has_no_text():
    clips = parse_clippings(VARIANT_ENTRIES)
    bookmark = clips[1]
    assert bookmark.type == "bookmark"
    assert bookmark.page == "51"
    assert bookmark.text == ""


def test_parse_no_author_and_location_only():
    clips = parse_clippings(VARIANT_ENTRIES)
    med = clips[2]
    assert med.title == "Meditations"
    assert med.author is None
    assert med.page is None
    assert med.location == "120-121"


def test_parse_roman_page_and_bad_date():
    clips = parse_clippings(VARIANT_ENTRIES)
    weird = clips[3]
    assert weird.title == "Some Report"
    assert weird.author == "Institute"
    assert weird.page == "ix"  # roman page preserved as a string
    assert weird.date is None  # malformed date -> None, entry still parses


def test_parse_all_four_variant_entries():
    assert len(parse_clippings(VARIANT_ENTRIES)) == 4


import hashlib


def expected_id(title, type_, location, text):
    key = f"{title}|{type_}|{location}|{text}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def make_clip(**kwargs):
    from datetime import datetime as dt
    defaults = dict(
        title="Peak", author="Anders Ericsson", type="highlight",
        page="45", location="680-682",
        date=dt(2026, 6, 1, 21, 12, 44),
        text="Some text.",
    )
    defaults.update(kwargs)
    return Clip(**defaults)


def test_clip_id_is_stable_hash():
    clip = make_clip()
    assert clip.id == expected_id("Peak", "highlight", "680-682", "Some text.")
    assert len(clip.id) == 12


def test_clip_id_ignores_date():
    from datetime import datetime as dt
    a = make_clip(date=dt(2026, 6, 1))
    b = make_clip(date=dt(2026, 6, 9))
    assert a.id == b.id


def test_dedupe_keeps_latest_date():
    from datetime import datetime as dt
    from sync import dedupe
    old = make_clip(date=dt(2026, 6, 1))
    new = make_clip(date=dt(2026, 6, 9))
    other = make_clip(text="Different text.")
    result = dedupe([old, other, new])
    assert len(result) == 2
    assert result[0].date == dt(2026, 6, 9)  # kept the later duplicate
    assert result[1].text == "Different text."


def test_dedupe_handles_missing_dates():
    from sync import dedupe
    a = make_clip(date=None)
    b = make_clip(date=None)
    assert len(dedupe([a, b])) == 1


def test_group_books_splits_by_title_and_author():
    from sync import group_books
    a = make_clip(title="Peak")
    b = make_clip(title="Meditations", author=None, text="Other.")
    books = group_books([a, b])
    assert set(books) == {("Peak", "Anders Ericsson"), ("Meditations", None)}


def test_clips_sorted_by_location_start_then_type():
    from sync import group_books
    note = make_clip(type="note", location="681", text="A note.")
    hl = make_clip(type="highlight", location="680-682")
    late = make_clip(type="highlight", location="900-901", text="Later.")
    same_loc_note = make_clip(type="note", location="680", text="Tie note.")
    books = group_books([late, note, same_loc_note, hl])
    ordered = books[("Peak", "Anders Ericsson")]
    assert [(c.type, c.location) for c in ordered] == [
        ("highlight", "680-682"),  # ties at 680: highlight ranks before note
        ("note", "680"),
        ("note", "681"),
        ("highlight", "900-901"),
    ]


def test_location_start_handles_missing_location():
    from sync import location_start
    assert location_start(make_clip(location=None)) == 0
    assert location_start(make_clip(location="680-682")) == 680


def test_render_highlight_block():
    from sync import render_clip
    clip = make_clip(text="Line one.")
    assert render_clip(clip) == (
        "> Line one.\n"
        ">\n"
        f"> — highlight · p. 45 · loc. 680-682 · 2026-06-01 ^{clip.id}"
    )


def test_render_note_block():
    from sync import render_clip
    clip = make_clip(type="note", location="681", text="My thought.")
    assert render_clip(clip) == (
        "Note: My thought.\n"
        f"— note · p. 45 · loc. 681 · 2026-06-01 ^{clip.id}"
    )


def test_render_bookmark_block():
    from sync import render_clip
    clip = make_clip(type="bookmark", page="51", location="760", text="")
    assert render_clip(clip) == (
        f"Bookmark · p. 51 · loc. 760 · 2026-06-01 ^{clip.id}"
    )


def test_render_omits_missing_page_and_date():
    from sync import render_clip
    clip = make_clip(page=None, date=None, text="Quote.")
    assert render_clip(clip) == (
        "> Quote.\n"
        ">\n"
        f"> — highlight · loc. 680-682 ^{clip.id}"
    )


def test_render_multiline_highlight_quotes_every_line():
    from sync import render_clip
    clip = make_clip(text="First line.\nSecond line.")
    assert render_clip(clip).startswith("> First line.\n> Second line.\n>\n> — ")


def test_render_book_golden():
    from sync import render_book
    hl = make_clip(text="The quote.")
    note = make_clip(type="note", location="681", text="My thought.")
    result = render_book("Peak", "Anders Ericsson", [hl, note], "2026-07-09")
    assert result == (
        "---\n"
        'title: "Peak"\n'
        'author: "Anders Ericsson"\n'
        "last_synced: 2026-07-09\n"
        "---\n"
        "<!-- GENERATED by sync.py — edits are overwritten on every Kindle sync -->\n"
        "\n"
        "# Peak\n"
        "*Anders Ericsson*\n"
        "\n"
        "## Highlights\n"
        "\n"
        "> The quote.\n"
        ">\n"
        f"> — highlight · p. 45 · loc. 680-682 · 2026-06-01 ^{hl.id}\n"
        "\n"
        "Note: My thought.\n"
        f"— note · p. 45 · loc. 681 · 2026-06-01 ^{note.id}\n"
    )


def test_render_book_without_author_skips_byline():
    from sync import render_book
    clip = make_clip(title="Meditations", author=None, text="Quote.")
    result = render_book("Meditations", None, [clip], "2026-07-09")
    assert "author: null\n" in result
    assert "*" not in result.split("# Meditations\n")[1].split("\n")[0]


def test_slugify():
    from sync import slugify
    assert slugify("Peak") == "peak"
    assert slugify("Deep Work: Rules!") == "deep-work-rules"
    assert slugify("!!!") == "untitled"
