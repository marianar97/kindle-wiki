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
