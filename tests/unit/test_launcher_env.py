import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "voice_launcher", Path(__file__).resolve().parents[2] / "scripts" / "launch.py"
)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_launcher_only_selects_existing_local_model_directory(tmp_path):
    env = launcher.launch_environment(tmp_path, {})
    assert "HERMES_VOICE_PIPER_DIR" not in env
    (tmp_path / ".local" / "piper-voices").mkdir(parents=True)
    env = launcher.launch_environment(tmp_path, {})
    assert env["HERMES_VOICE_PIPER_DIR"] == str(tmp_path / ".local" / "piper-voices")
    assert env["HERMES_VOICE_DATA_DIR"] == str(tmp_path / ".local" / "app")


def test_launcher_preserves_explicit_environment(tmp_path):
    original = {"HERMES_VOICE_PIPER_DIR": "/custom/models", "HERMES_VOICE_DATA_DIR": "/custom/data"}
    assert launcher.launch_environment(tmp_path, original) == original
