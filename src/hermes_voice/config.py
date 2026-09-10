import importlib.util
import json
import os
from pathlib import Path

import yaml
from platformdirs import user_data_dir


def source_path():
    return Path(
        os.environ.get("HERMES_SOURCE", str(Path.home() / ".hermes/hermes-agent"))
    ).expanduser()


def data_path():
    return Path(
        os.environ.get("HERMES_VOICE_DATA_DIR", user_data_dir("hermes-voice", appauthor=False))
    ).expanduser()


class Settings:
    def __init__(self, root):
        self.path = root / "settings.json"
        home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
        try:
            upstream = yaml.safe_load((home / "config.yaml").read_text()) or {}
        except (OSError, ValueError, yaml.YAMLError):
            upstream = {}
        model = upstream.get("model", {}) if isinstance(upstream, dict) else {}
        if isinstance(model, str):
            model = {"default": model}
        if not isinstance(model, dict):
            model = {}
        self.values = dict(
            model=model.get("default") if isinstance(model.get("default"), str) else "",
            provider=model.get("provider") if isinstance(model.get("provider"), str) else "auto",
            fast_model="",
            voice_provider="none",
            voice="",
            language="auto",
        )
        try:
            saved = json.loads(self.path.read_text())
            self.values.update(
                {k: v for k, v in saved.items() if k in self.values and isinstance(v, str)}
            )
        except (OSError, ValueError, AttributeError):
            pass

    def public(self):
        available = (source_path() / "run_agent.py").is_file() and all(
            importlib.util.find_spec(name) is not None for name in ("dotenv", "openai")
        )
        return dict(self.values, hermes_available=available, hermes_source=str(source_path()))

    def update(self, values):
        self.values.update(values)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.values, indent=2))
        temp.chmod(0o600)
        temp.replace(self.path)
        return self.public()
