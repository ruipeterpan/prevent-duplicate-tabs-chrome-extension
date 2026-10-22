# Working on this extension

- This is an independently maintained patched version of Prevent Duplicate Tabs
  1.8.2. Preserve the original author's attribution and the license status in
  README.md and UPSTREAM.txt.
- For reinstall requests, load the existing `extension/` directory. No build or
  upstream installation is required. Do not run build.py just to reinstall.
- The readable patch is `extension/exact-match-fix.js`. Most other extension
  JavaScript is upstream bundled code. Avoid broad edits to those bundles.
- The original background implementation is preserved in
  `reference/background.original.js` for regression comparisons.
- Run `npm test` after detector changes. There are no npm dependencies.
- Use the available computer-control tools for Chrome and Alfred interactions.
  Validate a fresh-start sequence: close test Calendar tabs, open Calendar once,
  launch it repeatedly, and confirm exactly one tab per exact URL survives.
- Verify `/calendar/u/0/r` and `/calendar/u/1/r` stay separate. Keep the debugger
  closed during behavior tests; it changes service-worker lifetime.
- Do not assume the extension ID is the same on another computer. Identify the
  entry by its name, `Prevent Duplicate Tabs — Patched`.
- Do not remove the user's installed store extension or unrelated tabs. When
  installing the local fix, disable the competing duplicate detector for testing.
- Keep browsing profiles, cookies, credentials, private settings exports, and
  unrelated project files out of commits.
