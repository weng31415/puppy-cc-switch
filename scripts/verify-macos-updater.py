#!/usr/bin/env python3

import pathlib
import sys
import tarfile


def fail(message: str) -> None:
    print(f"macOS updater validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: verify-macos-updater.py <archive.tar.gz>")

    archive = pathlib.Path(sys.argv[1])
    if not archive.is_file():
        fail(f"archive not found: {archive}")

    try:
        with tarfile.open(archive, "r:gz") as updater:
            members = updater.getmembers()
    except (OSError, tarfile.TarError) as error:
        fail(f"cannot read {archive}: {error}")

    if not members:
        fail("archive is empty")

    roots: set[str] = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        parts = path.parts
        if path.is_absolute() or ".." in parts:
            fail(f"unsafe archive path: {member.name}")
        if not parts:
            fail("archive contains an empty path")
        if parts[0] == "__MACOSX" or any(part.startswith("._") for part in parts):
            fail(f"AppleDouble metadata entry: {member.name}")
        roots.add(parts[0])

    if len(roots) != 1:
        fail(f"expected one top-level app bundle, found: {sorted(roots)}")

    root = next(iter(roots))
    if not root.endswith(".app"):
        fail(f"top-level entry is not an app bundle: {root}")

    required_suffixes = (
        "/Contents/Info.plist",
        "/Contents/MacOS/",
        "/Contents/_CodeSignature/CodeResources",
    )
    names = {member.name for member in members}
    for suffix in required_suffixes:
        if not any(name == f"{root}{suffix}" or name.startswith(f"{root}{suffix}") for name in names):
            fail(f"missing required app content: {root}{suffix}")

    print(
        f"macOS updater verified: {archive} "
        f"({len(members)} entries, root {root})"
    )


if __name__ == "__main__":
    main()
