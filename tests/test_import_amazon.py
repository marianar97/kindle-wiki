import json

from import_amazon import books_from_payload, clips_from_book, run

BOOK = {
    "title": "Show Your Work",
    "author": "Austin Kleon",
    "highlights": [
        {"text": "You don't have to be a genius.", "location": "245", "page": "18"},
        {"text": "Share something small every day.", "location": "310",
         "note": "Connect to the wiki project."},
        {"text": "", "location": "400"},
    ],
}


def test_books_from_payload_single_book():
    assert books_from_payload(BOOK) == [BOOK]


def test_books_from_payload_library_wrapper():
    payload = {"books": [BOOK, {"title": "Other", "highlights": []}]}
    assert len(books_from_payload(payload)) == 2


def test_clips_from_book_maps_highlights():
    clips = clips_from_book(BOOK)
    hl = clips[0]
    assert hl.title == "Show Your Work"
    assert hl.author == "Austin Kleon"
    assert hl.type == "highlight"
    assert hl.page == "18"
    assert hl.location == "245"
    assert hl.date is None
    assert hl.text == "You don't have to be a genius."


def test_clips_from_book_note_becomes_separate_clip():
    clips = clips_from_book(BOOK)
    types = [(c.type, c.location) for c in clips]
    assert ("highlight", "310") in types
    assert ("note", "310") in types


def test_clips_from_book_skips_empty_text():
    clips = clips_from_book(BOOK)
    assert all(c.text for c in clips)
    assert len(clips) == 3  # 2 highlights + 1 note; empty one skipped


def test_clips_from_book_coerces_numeric_fields():
    book = {"title": "T", "highlights": [{"text": "Q", "location": 245, "page": 18}]}
    clip = clips_from_book(book)[0]
    assert clip.location == "245"
    assert clip.page == "18"


def test_run_end_to_end(tmp_path, capsys):
    source = tmp_path / "export.json"
    source.write_text(json.dumps(BOOK), encoding="utf-8")
    root = tmp_path / "project"
    assert run(source, root) == 0
    out = capsys.readouterr().out
    assert "3 new clips across 1 books" in out
    book_file = root / "vault" / "raw" / "books" / "show-your-work.md"
    assert book_file.exists()
    content = book_file.read_text(encoding="utf-8")
    assert "> You don't have to be a genius." in content
    assert "Note: Connect to the wiki project." in content
    archives = list((root / "vault" / "raw" / "clippings").glob("*amazon-notebook.json"))
    assert len(archives) == 1


def test_run_is_idempotent(tmp_path, capsys):
    source = tmp_path / "export.json"
    source.write_text(json.dumps(BOOK), encoding="utf-8")
    root = tmp_path / "project"
    run(source, root)
    run(source, root)
    out = capsys.readouterr().out
    assert "0 new clips across 0 books" in out.splitlines()[-1]


def test_run_missing_source_fails_loudly(tmp_path, capsys):
    assert run(tmp_path / "nope.json", tmp_path / "project") == 1
    assert "not found" in capsys.readouterr().err


def test_run_bad_json_root_fails_loudly(tmp_path, capsys):
    source = tmp_path / "export.json"
    source.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    assert run(source, tmp_path / "project") == 1
    assert "Could not parse" in capsys.readouterr().err
