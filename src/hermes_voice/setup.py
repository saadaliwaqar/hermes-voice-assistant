"""Read-only setup diagnostics and explicitly requested, disposable model tests."""

import asyncio
import json
import os
import signal
import sys
import tempfile
from pathlib import Path

import yaml

from .config import source_path

IMPORT_TIMEOUT = 8
MODEL_TIMEOUT = 30
DEFAULT_KEYS = ("model", "provider", "fast_model", "voice_provider", "voice", "language")
MODEL_KEYS = (
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "XAI_API_KEY",
    "HF_TOKEN",
    "GLM_API_KEY",
    "MINIMAX_API_KEY",
    "KIMI_API_KEY",
    "DASHSCOPE_API_KEY",
    "COPILOT_GITHUB_TOKEN",
    "MINIMAX_CN_API_KEY",
    "XIAOMI_API_KEY",
    "KILOCODE_API_KEY",
    "AI_GATEWAY_API_KEY",
    "OPENCODE_ZEN_API_KEY",
    "OPENCODE_GO_API_KEY",
    "MISTRAL_API_KEY",
    "GROQ_API_KEY",
)


def hermes_home():
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()


async def run_child(code, *, cwd, env, timeout, payload=None):
    """Hard deadline, no output capture (provider output can contain secrets).

    A new process group lets cancellation kill descendants as well as Python.
    Always reap the child before releasing the concurrency slot/temp directory.
    """
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-B",
        "-c",
        code,
        cwd=cwd,
        env=env,
        stdin=asyncio.subprocess.PIPE if payload is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=os.name == "posix",
    )
    try:
        await asyncio.wait_for(process.communicate(payload), timeout)
        return process.returncode
    finally:
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        elif process.returncode is None:
            process.kill()
        await process.wait()


def child_environment(directory):
    # Allowlist: no live sessions, terminal behavior, plugins, Python path injection
    # or unrelated service credentials. Keep platform and TLS/proxy essentials.
    allowed = set(MODEL_KEYS) | {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "OPENAI_BASE_URL",
        "OPENROUTER_BASE_URL",
        "ANTHROPIC_BASE_URL",
    }
    env = {key: value for key, value in os.environ.items() if key in allowed}
    env.update(
        HERMES_HOME=str(directory),
        HOME=str(directory),
        XDG_CONFIG_HOME=str(directory),
        XDG_DATA_HOME=str(directory),
        XDG_CACHE_HOME=str(directory),
        PYTHONDONTWRITEBYTECODE="1",
    )
    return env


def isolated_config(directory):
    """Copy only auth material and model routing into a private disposable home.

    No symlinks to the real home: OAuth refreshes cannot modify the user's files.
    Plugins, histories, hooks, logging paths and other behavioral config are not copied.
    """
    home = hermes_home()
    for name in ("auth.json",):
        path = home / name
        if path.is_file():
            target = directory / name
            target.write_bytes(path.read_bytes())
            target.chmod(0o600)
    # Preserve dotenv quoting for supported single-line model credentials only.
    # Never copy arbitrary env directives into the probe's Hermes bootstrap.
    try:
        lines = (home / ".env").read_text().splitlines()
    except OSError:
        lines = []
    selected = []
    for line in lines:
        key, separator, _ = line.strip().removeprefix("export ").partition("=")
        if separator and key.strip() in MODEL_KEYS:
            selected.append(line)
    target = directory / ".env"
    target.write_text("\n".join(selected) + "\n")
    target.chmod(0o600)
    try:
        upstream = yaml.safe_load((home / "config.yaml").read_text()) or {}
    except (OSError, ValueError, yaml.YAMLError):
        upstream = {}
    model = upstream.get("model", {}) if isinstance(upstream, dict) else {}
    if isinstance(model, dict):
        model = {
            k: v for k, v in model.items() if k in {"default", "provider", "base_url", "api_key"}
        }
    config = {
        "model": model,
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "compression": {"enabled": False},
        "checkpoints": {"enabled": False},
    }
    target = directory / "config.yaml"
    target.write_text(yaml.safe_dump(config))
    target.chmod(0o600)


async def probe_import(statement, source=None):
    with tempfile.TemporaryDirectory(prefix="hermes-voice-check-") as name:
        directory = Path(name)
        # Imports must not make network connections, initialize models or touch real home.
        code = (
            "import sys, socket\n"
            "def deny(*a, **k): raise RuntimeError('Network disabled in import check')\n"
            "socket.socket.connect = deny\nsocket.socket.connect_ex = deny\n"
            "socket.create_connection = deny\n"
        )
        if source is not None:
            code += f"sys.path.insert(0, {str(source)!r})\n"
        code += statement
        try:
            result = await run_child(
                code, cwd=directory, env=child_environment(directory), timeout=IMPORT_TIMEOUT
            )
            return "ready" if result == 0 else "missing"
        except TimeoutError:
            return "warning"
        except Exception:
            return "missing"


def credential_checks():
    # Only booleans leave this function. No provider resolver or token refresh on GET.
    home = hermes_home()
    present = {key for key in MODEL_KEYS if os.environ.get(key, "").strip()}
    speech_present = {
        key
        for key in ("HERMES_VOICE_ELEVENLABS_KEY", "HERMES_VOICE_OPENAI_KEY")
        if os.environ.get(key, "").strip()
    }
    # Read .env without loading it into this process/global environment.
    try:
        for line in (home / ".env").read_text().splitlines():
            key, separator, value = line.strip().removeprefix("export ").partition("=")
            if separator and value.strip().strip("\"'"):
                present.add(key.strip())
    except OSError:
        pass
    model_key = bool(present.intersection(MODEL_KEYS))
    try:
        config = yaml.safe_load((home / "config.yaml").read_text())
        model_key |= bool(
            isinstance(config, dict)
            and isinstance(config.get("model"), dict)
            and config["model"].get("api_key")
        )
    except (OSError, ValueError, yaml.YAMLError):
        pass
    return [
        dict(
            id="model_credentials",
            label="Model credentials",
            status="ready" if model_key else "warning",
            detail="A model key is configured; not validated."
            if model_key
            else "No known model API key detected. OAuth or a keyless local provider may still work; use Test model.",
        ),
        dict(
            id="oauth_credentials",
            label="Hermes authentication store",
            status="warning",
            detail="Authentication store exists; credentials not validated."
            if (home / "auth.json").is_file()
            else "No authentication store found; optional for API-key providers.",
        ),
        *[
            dict(
                id=identifier,
                label=label,
                status="ready" if key in speech_present else "warning",
                detail="Key configured; not validated."
                if key in speech_present
                else "Optional key not configured; text-only and other speech providers remain available.",
            )
            for identifier, label, key in (
                ("elevenlabs_key", "ElevenLabs key", "HERMES_VOICE_ELEVENLABS_KEY"),
                ("openai_voice_key", "Dedicated OpenAI speech key", "HERMES_VOICE_OPENAI_KEY"),
            )
        ],
    ]


class SetupService:
    def __init__(self, root, settings):
        self.path = root / "setup.json"
        self.settings = settings
        self.model_lock = asyncio.Lock()
        self.check_lock = asyncio.Lock()

    def completed(self):
        try:
            value = json.loads(self.path.read_text())
            return isinstance(value, dict) and value.get("completed") is True
        except (OSError, ValueError):
            return False

    def complete(self):
        # Atomic, non-secret, independent of settings and model-test results.
        temp = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=self.path.parent, delete=False) as file:
                temp = Path(file.name)
                json.dump({"completed": True}, file)
                file.flush()
                os.fsync(file.fileno())
            temp.replace(self.path)
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)
        return {"completed": True}

    async def status(self):
        async with self.check_lock:
            source = source_path()
            found = (source / "run_agent.py").is_file()
            checks = [
                dict(
                    id="hermes_source",
                    label="Hermes source",
                    status="ready" if found else "missing",
                    detail="Local source file found; this alone does not verify the runtime."
                    if found
                    else "Hermes source not found. Set HERMES_SOURCE to your local Hermes installation.",
                )
            ]
            runtime, stt, edge, piper = await asyncio.gather(
                probe_import(
                    "from run_agent import AIAgent\nfrom hermes_cli.runtime_provider import resolve_runtime_provider",
                    source,
                )
                if found
                else asyncio.sleep(0, result="missing"),
                probe_import("from faster_whisper import WhisperModel"),
                probe_import("from edge_tts import Communicate"),
                probe_import("from piper import PiperVoice"),
            )
            for identifier, label, status, ready, missing in (
                (
                    "hermes_runtime",
                    "Hermes Python runtime",
                    runtime,
                    "AIAgent and provider resolver import in the app interpreter; no model request made.",
                    "Source found but runtime import failed. Install Hermes dependencies in the app interpreter."
                    if found
                    else "Runtime not checked because the source path is missing.",
                ),
                (
                    "local_stt",
                    "Local transcription",
                    stt,
                    "Whisper imports; model download and microphone/transcription are not tested.",
                    "Local transcription dependencies cannot import. Install hermes-voice[speech], or use text-only.",
                ),
                (
                    "edge_tts",
                    "Optional Edge speech",
                    edge,
                    "Edge speech imports; network synthesis is not tested.",
                    "Optional Edge dependency cannot import; text-only is available.",
                ),
                (
                    "piper",
                    "Optional Piper speech",
                    piper,
                    "Piper imports; local voice model files and synthesis are not tested.",
                    "Optional Piper dependency cannot import; other providers are available.",
                ),
            ):
                checks.append(
                    dict(
                        id=identifier,
                        label=label,
                        status=status,
                        detail=ready
                        if status == "ready"
                        else "Import check timed out; runtime readiness is unknown."
                        if status == "warning"
                        else missing,
                    )
                )
            checks.extend(credential_checks())
            return dict(
                completed=self.completed(),
                checks=checks,
                defaults={k: self.settings.values[k] for k in DEFAULT_KEYS},
            )

    async def _model_probe(self, model, provider):
        with tempfile.TemporaryDirectory(prefix="hermes-voice-model-") as name:
            directory = Path(name)
            isolated_config(directory)
            source = source_path()
            if not (source / "run_agent.py").is_file():
                return False
            code = (
                f"import sys; sys.path.insert(0, {str(Path(__file__).parent.parent)!r}); "
                f"sys.path.insert(0, {str(source)!r}); "
                "from hermes_voice.setup_worker import main; main()"
            )
            result = await run_child(
                code,
                cwd=directory,
                env=child_environment(directory),
                timeout=MODEL_TIMEOUT,
                payload=json.dumps({"model": model, "provider": provider}).encode(),
            )
            return result == 0

    async def test_model(self, model, provider):
        if self.model_lock.locked():
            return dict(
                ok=False, message="A model test is already running. Try again when it finishes."
            )
        async with self.model_lock:
            try:
                ok = await self._model_probe(model, provider)
                return dict(
                    ok=ok,
                    message="Model responded successfully. Settings were not saved."
                    if ok
                    else "Model test failed. Check Hermes runtime, model/provider and authentication settings.",
                )
            except TimeoutError:
                return dict(
                    ok=False,
                    message="Model test timed out and was stopped. Try again or skip for text-only setup.",
                )
            except Exception:
                return dict(
                    ok=False,
                    message="Model test failed. Check Hermes runtime, model/provider and authentication settings.",
                )
