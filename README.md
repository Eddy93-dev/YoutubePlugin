# YouTube Watched Hider

Chrome extension (Manifest V3, no build step, no dependencies):

- **Watched videos:** hides or grays out videos you've watched past a threshold (default 80%) on Subscriptions, Home, Search and the watch-page sidebar. Each page can be switched on or off.
- **Manual hide:** hover a thumbnail and click the eye icon to hide that video everywhere, with Undo. They follow the Hide / Gray out choice; when grayed out, the same button becomes an eye icon that shows the video again. Switch "Hide videos I've hidden" off to show them again without losing the list. Each hide expires automatically 48 hours after you made it. Stored locally on this device.
- **Channel allowlist:** channels you list (by `@handle` or name) are never hidden.
- **Shorts:** optionally hides Shorts shelves, Shorts cards and the sidebar entry, and redirects `/shorts/` pages to Home.
- **Tile size:** choose how many videos per row (Auto or 3–8) for smaller thumbnails on Home, Subscriptions and channel pages.
- **Badge:** the toolbar icon shows how many items were hidden on the current page.
- **Settings button:** a button next to YouTube's search bar opens the settings in a panel, so you don't need to pin the extension.
- **Shortcut:** `Alt+Shift+H` toggles the watched filter (change it at `chrome://extensions/shortcuts`).

## Install (development)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Click the extension icon to change settings. Changes apply immediately.

## Scripts
- `npm test`: unit tests for `lib.js`
- `npm run icons`: regenerate `icons/*.png`
- `npm run pack`: build `dist/youtube-watched-hider-<version>.zip` for the Chrome Web Store

## Publishing to the Chrome Web Store
1. Bump `version` in `manifest.json`, then run `npm run pack`.
2. Upload the zip at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 registration).
3. Privacy tab: the extension collects no user data. Settings stay in `chrome.storage.sync`. The only permission is `storage`, and the only host is `www.youtube.com`, used by the content script.
4. Add a 1280×800 screenshot and a short description.

## Versioning
`version` in `manifest.json` is the single source of truth; the settings panel shows it at the bottom.
Bump the minor version for each new feature (0.4.0 → 0.5.0) and the patch version for fixes (0.4.0 → 0.4.1).

## Maintenance
YouTube changes its markup often. If filtering stops working, update the `SEL` selectors at the top of `content.js`.
