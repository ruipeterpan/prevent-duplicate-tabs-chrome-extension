# Prevent Duplicate Tabs Patched

An independently maintained, patched version of **Prevent Duplicate Tabs 1.8.2**
by **SQ Tech / Sharoon**. It fixes missed duplicates when opening URLs repeatedly
from launchers such as Alfred. When an exact URL is already open, it closes the
new duplicate and focuses the existing tab and its Chrome window.

- [Original Chrome Web Store extension](https://chromewebstore.google.com/detail/prevent-duplicate-tabs/jjnoehggdfcblljkkeijmooameiaiani)
- [Original repository link provided by the extension](https://github.com/sharoon7171/prevent-duplicate-tabs)

The original settings interface, icons, and bundled assets are retained. This
project is not the official upstream release and does not claim endorsement by
the original author. See [Upstream credit and license status](#upstream-credit-and-license-status).

This repository includes the complete installable extension, its shipped
JavaScript and assets, the readable fix, and regression tests. A new laptop does
not need the original extension, the original repository, Node.js, or a build step
to install the saved version.

## Install in Chrome

1. Download the repository using **Code → Download ZIP**, then extract it, or
   clone it with Git. Keep the extracted folder in a permanent location.
2. Open `chrome://extensions` in the Chrome profile where your launcher opens links.
3. Disable another duplicate-tab extension in that profile so the two extensions
   do not interfere. The original store extension can stay installed and disabled.
4. Enable **Developer mode**, choose **Load unpacked**, and select the
   `extension` folder inside this repository. Select the folder containing
   `manifest.json`, not the repository's outer folder.
5. Confirm that **Prevent Duplicate Tabs — Patched** is enabled. Its default
   action is **Close new duplicate tab and switch to existing tab**, all windows
   are checked, and **Ignore URL parameters** is off.
6. Close existing Calendar tabs, launch the Calendar bookmark in Alfred, then
   launch it several more times. One tab for the exact URL should remain.

The extension needs access to tab URLs and can activate or close matching tabs.
It does not read page content. The fix adds no network requests. The retained
upstream code uses Chrome's sync storage for settings and the duplicate counter.

Keep the extension folder: Chrome loads the code from that location. If you move
it, remove the old unpacked entry and load it from its new location. Unpacked
extensions do not install automatically on another laptop through Chrome Sync,
and a different installation path can produce a different extension ID and fresh
settings. Chrome profiles, credentials, open tabs, and individual extension
preferences are not included in the repository.

## What was fixed

The upstream detector inferred that a matching tab with an opener, adjacent tab
placement, and active state was an intentional Chrome Duplicate Tab action.
Alfred URL launches also have that metadata, so freshly opened duplicates could
be added to an in-memory bypass set and remain undetected.

The patch changes the detector in the following ways:

- Removes the automatic intentional-duplicate inference. The explicit
  context-menu commands for allowing duplicates remain available.
- Checks pending destinations as well as committed URLs, including tabs that
  initially have no URL.
- Serializes tab-event checks and startup scans so overlapping launches use a
  consistent survivor.
- Rechecks both tabs before closing a duplicate, accounting for navigation or
  removal while asynchronous calls are pending.
- Activates the survivor and focuses its window before removing a duplicate.
  If activation fails, the duplicate stays available.
- Keeps normal and incognito tabs separate and avoids explicitly removing a
  window based on an outdated emptiness check.

Exact matching includes the query string, fragment, and trailing slash. In
particular, `/calendar/u/0/r` and `/calendar/u/1/r` remain different. The optional
upstream parameter-ignoring setting remains available but is off by default.

## Files and development

- `extension/` is the ready-to-load Chrome extension, including local fonts and
  icons. `extension/exact-match-fix.js` contains the readable patch.
- `reference/background.original.js` preserves the shipped upstream background
  code used by the regression tests.
- `test/` contains a Chrome API simulation and the original and fixed scenarios.
- `build.py` can recreate the patched package from an installed upstream 1.8.2
  package. It is optional and is not needed to install this saved version.
- `UPSTREAM.txt` records provenance and the manual validation details.
- `validation.json` records the tested version and results.

To run the tests, install Node.js 22 or newer and run `npm test` from the repository
root. The tests have no package dependencies, so `npm install` is unnecessary.
After changing extension code, click **Reload** on its entry in
`chrome://extensions`, then repeat the fresh-start Alfred test with its debugger
closed.

## Validation

On October 21, 2026, the build passed 22 automated tests. Live testing in Chrome
and Alfred covered three fresh-start bursts, exact account separation, switching
across windows, and wake-up after Chrome reported the service worker inactive.
Across 21 launches, the counter confirmed 17 duplicate closures with no unintended
duplicates remaining. Browser restart and other operating systems were not
tested.

## Upstream credit and license status

Based on **Prevent Duplicate Tabs 1.8.2**, published by SQ Tech / Sharoon:

- [Original Chrome Web Store listing](https://chromewebstore.google.com/detail/prevent-duplicate-tabs/jjnoehggdfcblljkkeijmooameiaiani)
- [Repository linked by the original extension](https://github.com/sharoon7171/prevent-duplicate-tabs)

The original UI, icons, bundled libraries, and other upstream assets are retained.
The author's original TypeScript development project and a license file were not
available in the installed package. The linked upstream repository was not
accessible when this patch was prepared. **The upstream license remains
unresolved.** Public availability of this repository does not establish
permission from the original author or grant a license to the retained upstream
code and assets. Existing third-party notices are retained. No replacement
license is asserted over the upstream work.

The readable detector patch, regression tests, and documentation describe the
changes separately from the upstream bundle. This patched version has not been
submitted to the Chrome Web Store.
