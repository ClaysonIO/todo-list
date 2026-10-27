# Quick Todo

A single-page Android todo app built with [Capacitor](https://capacitorjs.com) and
[Capgo](https://capgo.app) live updates. Everything is stored on the device.
The design goal that drives every technology choice: **the todo list must be on
screen as fast as possible after tapping the icon.**

## Features

- Type at the top and press Enter to add an item (the input keeps focus so you can add several in a row).
- Tap an item's text to edit it inline. Tap ✕ twice to delete (the first tap arms it red for three seconds). Drag the ⋮⋮ handle to reorder.
- Every item has a **30-hour timer**, shown as a small clock on the right. Tap the clock to renew it for another 30 hours. When it runs out the item is removed, checked or not.
- Checked items move to the bottom of the list and are cleared at **1:00 am** even if their timer has not run out.
- The **Calendar** page shows a month at a time; swipe up for the next month and down for the previous one. Coloured dots mark days with tasks: open (today), planned one-offs, recurring runs of scheduled tasks, done, and missed. Tap a day to see its tasks, and add tasks to today or any future day (a future task joins the list at midnight on its day). Checked tasks sit on the day they were checked, tasks that expired unchecked on the day they were created, and open tasks on today.
- The **Expired** page lists everything that left the list, grouped and sorted by day.
- **Settings** lets you add scheduled tasks on a 5-field cron expression (local time), switch between system / light / dark theme, export all data to CSV, and import an exported CSV (merged in, skipping items already present; scheduled tasks and settings are not part of the CSV).

## Why it starts fast

| Decision | Effect on cold start |
| --- | --- |
| No framework: vanilla TypeScript with a few DOM helpers | Nothing to boot before rendering. The whole app is about 60 KB of HTML in one file. |
| `vite-plugin-singlefile` inlines JS and CSS into `index.html` | The WebView makes one asset request instead of three. |
| State lives in `localStorage` and is read synchronously | No async storage round trip before first paint. |
| Expiry, scheduling and the first render run before anything else in `src/main.ts` | The list is painted first. The add form, router, timers and Capacitor plugins are wired in `requestIdleCallback` afterwards. |
| An inline `<script>` in `<head>` applies the saved theme before CSS loads | No flash of the wrong theme. |
| The Android launch theme is a solid colour, not a splash bitmap, and `MainActivity` paints the WebView in the page background colour per light/dark mode | Nothing to decode at launch and no white flash before the first web frame. |
| Capgo `autoUpdate` is off by default | The app never touches the network on launch. |

## Project layout

```
index.html              Shell markup + pre-paint theme script
src/main.ts             Boot sequence, routing, wiring
src/store.ts            State, persistence, expiry sweep, schedules (pure functions)
src/cron.ts             5-field cron parser and next-occurrence search
src/csv.ts              CSV export
src/native.ts           Capacitor bridge (back button, resume, share, Capgo notifyAppReady)
src/ui/*.ts             List, expired page, settings page, DOM helpers
tests/                  Vitest unit tests for store, cron and CSV
android/                Generated Capacitor Android project
assets/                 Master icon SVGs (generated)
scripts/make-icons.mjs  Generates icon SVGs, adaptive-icon vectors and legacy PNG mipmaps
.github/workflows/      CI: tests, web build, debug APK artifact
```

## Development

```bash
npm install
npm run dev        # web preview at http://localhost:5173 (native plugins fall back to web behaviour)
npm test           # unit tests
npm run build      # typecheck + single-file production bundle in dist/
```

### Android

Requires Android Studio (or the SDK + JDK 21).

```bash
npm run cap:sync   # build web bundle and copy it into android/
npm run cap:open   # open in Android Studio
# or build an APK from the command line:
npm run android:apk   # -> android/app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Actions workflow builds a debug APK on every push and attaches it as
an artifact named `quick-todo-debug.apk`. When the signing secrets are set it
also attaches `quick-todo-release.aab`, a release bundle to upload to Google
Play.

### Signing

CI signs every APK with one fixed keystore, so each new build installs over
the previous one and keeps your data. It also sets `versionCode` to the run
number. Create the keystore once and keep a backup, because a lost key means
uninstalling to switch to a new one:

```bash
keytool -genkeypair -v -keystore quick-todo.jks -alias quicktodo \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 quick-todo.jks   # macOS: base64 -i quick-todo.jks
```

Then add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 output above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `quicktodo` (the `-alias` you chose) |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password unless you set one) |

Without the secrets the build still succeeds, but with a warning, and the APK
is signed with a throwaway debug key. To sign local builds with the same key,
export `ANDROID_KEYSTORE_PATH` and the three password and alias variables
before running Gradle.

### App icon

The launcher icon is generated from geometry in `scripts/make-icons.mjs`:
an adaptive icon (vector foreground, gradient background, monochrome layer
for Android 13 themed icons) plus legacy PNGs for API 24-25. After editing
the script run:

```bash
node scripts/make-icons.mjs            # needs playwright for the PNGs
node scripts/make-icons.mjs --no-png   # vectors and SVGs only
```

### Capgo live updates

The `@capgo/capacitor-updater` plugin is installed and `notifyAppReady()` is
called after the first paint. To turn on over-the-air updates:

```bash
npx @capgo/cli login <api-key>
npx @capgo/cli app add            # registers io.clayson.todo
npm run build && npx @capgo/cli bundle upload
```

Then set `plugins.CapacitorUpdater.autoUpdate` to `true` in
`capacitor.config.ts` and run `npm run cap:sync`.

## Behaviour details

- **Timer expiry** and the **1 am clear** are evaluated when the app starts, when it returns to the foreground, and every 30 seconds while it is open. If the app was closed at 1 am, checked items are cleared on the next launch and recorded in history with a 1:00 am timestamp.
- **Scheduled tasks** are evaluated at the same moments. If the app was closed across several occurrences (e.g. a daily task and the phone was off for three days) one item is added, not three, and it gets a full 30-hour timer from the moment it appears. Re-enabling a paused schedule never backfills.
- **Reordering** is only within the unchecked group or the checked group; a checked item can never sit above an unchecked one.
- **History** is capped at 2000 entries and can be cleared from the Expired page.
- **CSV export** contains active, checked and expired items with ISO-8601 timestamps. On Android it opens the system share sheet; in a browser it downloads.
