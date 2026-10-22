"""Rebuild the patched copy from the installed 1.8.2 extension.

Reads the installed package only. Does not change Chrome's installation, load an
extension, or copy Chrome's user settings. The separately authored patch remains
in extension/exact-match-fix.js. Upstream assets remain upstream-owned and their
license status remains unresolved; see README.md and UPSTREAM.txt.
"""

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = (
    Path.home() / "Library/Application Support/Google/Chrome/Default/Extensions"
    / "jjnoehggdfcblljkkeijmooameiaiani/1.8.2_0"
)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
args = parser.parse_args()
destination = ROOT / "extension"
destination.mkdir(exist_ok=True)
manifest = json.loads((args.source / "manifest.json").read_text())
if manifest["version"] != "1.8.2":
    raise SystemExit("This patch targets 1.8.2; review changes before patching another version.")
original = (args.source / "background.js").read_text()
anchor = "w(),_.initialize().catch"
if original.count(anchor) != 1:
    raise SystemExit("Unexpected background build; refusing to patch it.")
for path in args.source.iterdir():
    if path.name == "_metadata":
        continue
    if path.is_dir():
        shutil.copytree(path, destination / path.name, dirs_exist_ok=True)
    else:
        shutil.copy2(path, destination / path.name)
(ROOT / "reference").mkdir(exist_ok=True)
(ROOT / "reference/background.original.js").write_text(original)
manifest.pop("key", None)
manifest.pop("update_url", None)
manifest.update({
    "name": "Prevent Duplicate Tabs — Patched",
    "description": "Patched version of SQ Tech's Prevent Duplicate Tabs 1.8.2, fixing missed exact-URL duplicates from launchers such as Alfred.",
    "version": "1.8.2.1",
    "version_name": "1.8.2 + exact-match patch",
})
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
patched = 'import { applyExactMatchFix } from "./exact-match-fix.js";\n' + original.replace(
    anchor, "applyExactMatchFix(_,o);w(),_.initialize().catch"
)
(destination / "background.js").write_text(patched)
for path in destination.glob("*.js"):
    text = path.read_text()
    default = "duplicateAction:`close-new-stay-current`,ignoreParameters:"
    if default in text:
        path.write_text(text.replace(
            default, "duplicateAction:`close-new-switch-existing`,ignoreParameters:"
        ))
print("Patched extension prepared at", destination)
