# YouTube Watched Hider

Chrome extension (Manifest V3, no build step, no dependencies):

- **Watched videos:** hides or grays out videos you've watched past a threshold (default 80%) on Subscriptions, Home, Search, the watch-page sidebar and channel pages. Each page can be switched on or off.
- **Manual hide:** hover a thumbnail and click the eye icon to hide that video everywhere, with Undo. They follow the Hide / Gray out choice; when grayed out, the same button becomes an eye icon that shows the video again. Switch "Hide videos I've hidden" off to show them again without losing the list. Each hide expires automatically 48 hours after you made it. Stored locally on this device.
- **Keyword filter:** hide videos whose title contains a word, or matches a `/pattern/` (regular expression).
- **Age filter:** hide videos older than 1 day to 1 year (not on channel pages; reads YouTube's English "… ago" text).
- **Video types:** hide live streams, upcoming premieres, members-only videos, and mixes/playlists.
- **Channel groups:** sort your subscriptions into your own groups (Gaming, Coding, Languages…). Groups appear in YouTube's left sidebar above Subscriptions; click one to see only its channels' videos on Subscriptions, expand it to jump to a channel, or hover a channel there and click × to take it out of the group. In settings, "Clicking a group shows" switches between that filtered Subscriptions feed and **Latest uploads**: the group's channels' uploads newest first, read page by page from each channel's Videos tab, with more loading as you scroll. It opens in a couple of seconds and doesn't make YouTube page through your whole Subscriptions history, but it can't filter watched videos. Older videos are ordered by YouTube's "… ago" text, so within the same week, month or year the order across channels is approximate. A channel can be in several groups. Add a channel with the folder button that appears when you hover it in the sidebar's Subscriptions list, or with the groups button next to Subscribe on its channel page. Create groups there, with the sidebar's + button, or in the settings panel (which can also rename, reorder and delete them, and add channels by @handle or URL). Stored on this device and included in backups.
- **Channel blocklist:** always hide videos from channels you list (by `@handle` or name).
- **Never hide:** channels you list are never hidden by any automatic filter.
- **Shorts:** optionally hides Shorts shelves, Shorts cards and the sidebar entry, and redirects `/shorts/` pages to Home.
- **Feed clean-up:** hide the add-on shelves on Home (news, trending, posts, Playables, Shorts…) and Subscriptions ("Most relevant"), and sponsored tiles and banners.
- **Tile size:** choose how many videos per row (Auto or 3–8) for smaller thumbnails on Home, Subscriptions and channel pages.
- **Badge:** the toolbar icon shows how many items were hidden on the current page.
- **Settings button:** a button next to YouTube's search bar opens the settings in a panel, so you don't need to pin the extension.
- **Stats:** how many videos were filtered today, this week and this month, broken down by reason.
- **Layout warning:** if YouTube changes its page structure so videos or watched bars are no longer recognized, settings shows a warning.
- **Backup:** export all settings, lists and manually hidden videos to a JSON file, and import them on another computer.
- **Keyboard:** <kbd>H</kbd> hides the video under the mouse (keep pressing to clear the videos that slide into its place; on a grayed-out video, H brings it back), <kbd>P</kbd> peeks at everything hidden (outlined, with a bar to exit). Can be switched off in settings.
- **Shortcut:** `Alt+Shift+H` toggles the watched filter (change it at `chrome://extensions/shortcuts`).

## Settings

Open the settings from the toolbar icon or the button next to YouTube's search bar. Changes apply instantly.
Settings are grouped into collapsible sections; each header shows what's currently on, and the panel remembers which sections you keep open.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/settings-light.png" width="300" alt="Settings panel in light theme with default settings: hide anything watched past 80% on all pages, no extra filters, stats for the last 30 days"></td>
    <td align="center"><img src="docs/screenshots/settings-dark.png" width="300" alt="Settings panel in dark theme: gray out at 60%, keyword and channel filters, hide videos older than 3 months, hide upcoming and playlists, Home clean-up on, 5 videos per row, Shorts hidden"></td>
  </tr>
  <tr>
    <td align="center">Defaults: hide anything watched past 80%</td>
    <td align="center">Power setup: gray out at 60%, keyword, channel, age and type filters, Home clean-up, 5 per row, no Shorts</td>
  </tr>
</table>

## Install (release)
1. Download the latest `youtube-watched-hider-<version>.zip` from [Releases](https://github.com/Eddy93-dev/YoutubePlugin/releases/latest) and unzip it to a folder you'll keep.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick that folder.
3. To update, unzip the new version over the same folder and click reload ↻ on the extension's card.

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

## Versioning and releases
`version` in `manifest.json` is the single source of truth; the settings panel shows it at the bottom.
Bump the minor version for each new feature (0.4.0 → 0.5.0) and the patch version for fixes (0.4.0 → 0.4.1).

CI (`.github/workflows/ci.yml`) runs the tests and builds the package on every push and pull request.
When a push to `main` carries a version that has no release yet, it tags `v<version>` and publishes a
GitHub Release with the zip attached. Pushing a version bump is all it takes to release.

## Maintenance
YouTube changes its markup often. A few seconds after each video page loads, the extension checks whether its
selectors still match (videos, watched-progress bars, the settings button) and shows a warning at the top of
the settings panel if not. To fix, update the `SEL` selectors at the top of `content.js`.
Channel groups live in `groups.js`; their sidebar section is appended inside the guide's Home/Shorts section
(`ytd-guide-section-renderer` holding the `href="/"` entry), because YouTube re-orders the guide when foreign nodes
sit between its sections.
