"""Build a local, allowlisted source candidate. Never creates a remote or publishes."""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT_FILES = {
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".gitignore",
    ".gitattributes",
    ".env.example",
    "pyproject.toml",
    "MANIFEST.in",
    "package.json",
    "package-lock.json",
    "playwright.config.mjs",
    "Start Hermes Voice.command",
}
TREES = {
    "src": {".py", ".mjs", ".js", ".html", ".css"},
    "tests": {".py", ".mjs"},
    "scripts": {".py", ".mjs"},
    "docs": {".md", ".png"},
    ".github": {".yml", ".yaml", ".md"},
}
PATTERNS = {
    "private-key": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "github-token": r"\bgh[pousr]_[A-Za-z0-9]{30,}\b",
    "provider-key": r"\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}\b",
    "local-home-path": r"/(?:Users|home)/[A-Za-z0-9_.-]+/",
}


def collect_files(root):
    root = Path(root)
    result = []
    for p in root.iterdir():
        if p.name in ROOT_FILES:
            if p.is_symlink():
                raise ValueError("symlink: " + p.name)
            if p.is_file():
                result.append(p.name)
    for tree, extensions in TREES.items():
        folder = root / tree
        if folder.is_symlink():
            raise ValueError("symlink: " + tree)
        if not folder.is_dir():
            continue
        for p in folder.rglob("*"):
            rel = p.relative_to(root)
            if "__pycache__" in rel.parts or rel.parts[:2] == ("docs", "design"):
                continue
            if p.is_symlink():
                raise ValueError("symlink: " + rel.as_posix())
            if p.is_file() and p.suffix in extensions:
                result.append(rel.as_posix())
    return sorted(result)


def scan_text(name, text):
    return [
        {"file": name, "line": text.count("\n", 0, m.start()) + 1, "category": category}
        for category, pattern in PATTERNS.items()
        for m in re.finditer(pattern, text)
    ]


def build(root, output):
    root, output = Path(root), Path(output)
    names = collect_files(root)
    contents = {n: (root / n).read_bytes() for n in names}
    findings, broken = [], []
    for name, data in contents.items():
        if name.endswith(".png"):
            continue  # Screenshots require separate visual review.
        text = data.decode("utf-8")
        findings.extend(scan_text(name, text))
        if name.endswith(".md"):
            for target in re.findall(r"\]\(([^\s)]+)", text):
                if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target) or target.startswith("#"):
                    continue
                path = unquote(target.split("#")[0])
                full = (root / name).parent.joinpath(path).resolve()
                try:
                    relative = full.relative_to(root.resolve()).as_posix()
                except ValueError:
                    relative = "outside-candidate"
                if relative not in contents:
                    broken.append({"file": name, "target": target})
    if findings or broken:
        raise ValueError(json.dumps({"scan_findings": findings, "broken_relative_links": broken}))
    output.mkdir(parents=True, exist_ok=True)
    manifest = {n: hashlib.sha256(data).hexdigest() for n, data in contents.items()}
    archive = output / "hermes-voice-assistant-0.1.0a1-source.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in contents.items():
            info = zipfile.ZipInfo("hermes-voice-assistant/" + name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = (0o100755 if name.endswith(".command") else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    with zipfile.ZipFile(archive) as z:
        verified = {
            n.removeprefix("hermes-voice-assistant/"): hashlib.sha256(z.read(n)).hexdigest()
            for n in z.namelist()
        }
    assert verified == manifest
    (output / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        json.dumps(
            {
                "archive": str(archive),
                "files": len(manifest),
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "scan": "no heuristic matches; not a complete security audit",
                "relative_links": "passed",
                "archive_readback": "passed",
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path(".local/release-candidate"))
    args = parser.parse_args()
    build(args.root, args.output)
