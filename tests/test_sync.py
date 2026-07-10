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
