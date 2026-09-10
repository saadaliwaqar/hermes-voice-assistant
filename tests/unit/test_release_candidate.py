"""A source candidate must not sweep up local data or dereference links."""

import importlib.util
import sys
from pathlib import Path

import pytest


def builder():
    path = Path(__file__).resolve().parents[2] / "scripts/release_candidate.py"
    spec = importlib.util.spec_from_file_location("candidate", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_candidate_uses_public_allowlist(tmp_path):
    for name in [
        "README.md",
        "LICENSE",
        "src/hermes_voice/server.py",
        "docs/images/core.png",
        ".env",
        ".internal/progress.md",
        ".local/data.json",
        "test-results/error.md",
        "src/hermes_voice/__pycache__/server.pyc",
        "docs/design/private.html",
    ]:
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("fixture")
    assert set(builder().collect_files(tmp_path)) == {
        "README.md",
        "LICENSE",
        "src/hermes_voice/server.py",
        "docs/images/core.png",
    }


@pytest.mark.skipif(sys.platform == "win32", reason="Symlinks require Windows privileges")
def test_candidate_refuses_symlink(tmp_path):
    (tmp_path / "README.md").symlink_to(tmp_path / "missing.md")
    with pytest.raises(ValueError, match="symlink"):
        builder().collect_files(tmp_path)


def test_candidate_scanner_reports_categories_not_secret_values():
    scan = builder().scan_text
    assert scan("README.md", "User home: /" + "Users/private-person/project")
    token = "ghp_" + "A" * 36
    findings = scan("config.txt", token)
    assert findings and token not in str(findings)
