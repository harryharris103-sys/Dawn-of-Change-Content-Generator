# Verse Studio v0.2.1

Put these in the root of your repo, keeping the same layout:
- `index.html`            (single file — NIV text and logos are built in)
- `sw.js`                  (offline cache; must sit beside index.html)
- `manifest.webmanifest`   (makes the app installable)
- `icons/`                 (app icons used by the manifest)

## New in v0.2.1
- **Installable** – added a web app manifest and icons, so Brave/Chrome/Edge show the install button in the address bar. Must be opened over https:// (GitHub Pages works).

## New in v0.2.0
- **Offline use** – after one online visit the app opens with no internet. Your repo's Bible versions and pictures are also saved in the browser.
- **Repo detection** – scans the whole repo/branch (default `main`) for:
  - Bible `.json` files (any folder, any supported schema; non-Bible JSON is ignored)
  - pictures: names containing "logo" become logos, everything else becomes a background (Background menu → "From GitHub repo")
- **Sync button (⟳)** – re-reads the repo now; adds new files, updates changed ones, removes deleted ones. It also runs automatically on load (at most every 2 min).
- **Light / dark mode** – ☀/☾ button, remembered per browser.
- Manual **Import** (Bible versions, fonts, backgrounds, audio) still works.

## Settings
Open **Repo settings** at the top of the panel. On `owner.github.io/repo` the owner/repo are detected automatically; the branch defaults to `main`. Change them there (or paste a github.com URL into the owner box) for custom domains or other branches. The repo must be public.

## Notes
- GitHub's unauthenticated API allows ~60 requests/hour per visitor; each sync uses one.
- Imported fonts, uploaded backgrounds and audio are not stored in history/share links. Repo pictures *are* shareable (same repo = same pictures).
- If a new version doesn't appear after you update `index.html`, reload once (the service worker serves the saved copy only when offline).
