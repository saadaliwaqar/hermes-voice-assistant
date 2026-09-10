"""Release metadata is an explicit contract, not inferred from a README badge."""

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_alpha_metadata_declares_owner_selected_license_and_readme():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    assert project["license"] == "MIT"
    assert project["readme"] == "README.md"
    assert "LICENSE" in project["license-files"]
    assert "THIRD_PARTY_NOTICES.md" in project["license-files"]
    assert "Development Status :: 3 - Alpha" in project["classifiers"]
    for name in project["license-files"]:
        assert (ROOT / name).is_file()
