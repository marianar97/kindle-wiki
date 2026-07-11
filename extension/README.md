# Kindle Wiki Sync

Chrome extension that syncs the whole Amazon Kindle library from
read.amazon.com/notebook into this repo's Obsidian vault (`vault/raw/`).
Sole writer of `vault/raw/` — replaces the old `sync.py` / bookmarklet flow.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` directory.

## Use

1. Make sure you are logged in at https://read.amazon.com/notebook.
2. Click the Kindle Wiki Sync toolbar icon — a sync tab opens.
3. First run: click **Choose vault folder** and pick `kindle-wiki/vault`.
4. Click **Sync highlights**. Progress shows per book; the summary reports
   new clips. Chrome may re-ask folder permission once per browser session.

## Scheduled sync

After choosing a vault, you can enable a background **Daily** or **Weekly**
sync from the sync tab. The first run occurs one full interval later; changing
the cadence does not start a sync immediately. Successful scheduled runs are
silent. A failed scheduled run shows a Chrome notification and a red `!` on
the extension icon; click the notification to open the sync tab and recover.

## What it writes

- `vault/raw/books/<slug>.md` — rendered highlights, stable `^id` anchors.
- `vault/raw/clippings/<timestamp>-amazon-notebook.json` — snapshot per sync.
It never deletes files.

## Development

```bash
npm install
npm test
```
