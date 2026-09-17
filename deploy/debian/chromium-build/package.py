#!/usr/bin/env python3
"""Stage a completed ARM64 build without installing or activating it."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

work = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
inputs = work / "inputs/deploy/chromium/patches"
manifest_path = inputs / "chromium-151-sources.json"
manifest = json.loads(manifest_path.read_text())
assert (work / "source.ready").read_text().strip() == hashlib.sha256(manifest_path.read_bytes()).hexdigest()
source = work / ("chromium-" + manifest["chromium_version"])
out = source / "out/Tikpal"
assert out.joinpath("chrome").is_file(), "Browser compilation must finish first"
name = "tikpal-chromium-" + manifest["chromium_version"] + "-arm64"
stage = destination / name
archive = destination / (name + ".tar.gz")
assert not stage.exists() and not archive.exists(), "Refusing to overwrite an existing package"
inventory = subprocess.check_output([
    str(source / "buildtools/linux64/gn"), "desc", "out/Tikpal",
    "//chrome:chrome", "runtime_deps",
], cwd=source, text=True)
paths = sorted(set(inventory.splitlines()) | {"chrome_sandbox"})
for entry in paths:
    relative = Path(entry)
    assert not relative.is_absolute() and ".." not in relative.parts, entry
    assert (out / relative).is_file() and not (out / relative).is_symlink(), entry
stage.mkdir(parents=True)
for entry in paths:
    target_name = {"chrome": "chromium-bin", "chrome_sandbox": "chrome-sandbox"}.get(str(Path(entry)), entry)
    target = stage / target_name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out / entry, target)
    with target.open("rb") as handle:
        header = handle.read(20)
    if header[:4] == b"\x7fELF":
        assert header[4:6] == b"\x02\x01" and int.from_bytes(header[18:20], "little") == 183, entry
        subprocess.run([str(source / "third_party/llvm-build/Release+Asserts/bin/llvm-strip"), "--strip-unneeded", str(target)], check=True)
wrapper = stage / "chromium"
wrapper.write_text('#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/chromium-bin" "$@"\n')
wrapper.chmod(0o755)
(stage / "chrome-sandbox").chmod(0o755)  # Establish root:root/4755 on the target.
provenance = stage / "build-provenance"
provenance.mkdir()
shutil.copy2(manifest_path, provenance / manifest_path.name)
for patch_key in ("local_patch", "touch_factory_patch"):
    patch = manifest[patch_key]
    shutil.copy2(inputs / patch["file"], provenance / patch["file"])
args = (out / "args.gn").read_text()
args = re.sub(
    r'^(\s*google_api_key\s*=\s*)"(?:[^"\\]|\\.)*"\s*$',
    r'\1"<redacted>"',
    args,
    flags=re.MULTILINE,
)
(provenance / "args.gn").write_text(args)
shutil.copy2(source / "LICENSE", provenance / "LICENSE")
(provenance / "runtime-deps.txt").write_text(inventory)
checksums = []
for path in sorted(stage.rglob("*")):
    if path.is_file():
        h = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                h.update(block)
        digest = h.hexdigest()
        checksums.append(f"{digest}  {path.relative_to(stage)}\n")
(stage / "SHA256SUMS").write_text("".join(checksums))
with tarfile.open(archive, "w:gz", compresslevel=1) as tar:
    tar.add(stage, arcname=name)
print(archive)
print("Package staged; target dependency and hardware decode acceptance remain pending.")
