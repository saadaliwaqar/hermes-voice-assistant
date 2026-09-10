"""Opt-in real Spark native callback probe; prints timing metadata only.
Run with .venv/bin/python tests/integration/probe_native_streaming.py.
Uses a temporary Hermes home and a private copy of OAuth auth.json; no app history.
"""

import contextlib
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


def run():
    real_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    with tempfile.TemporaryDirectory(prefix="voice-stream-probe-") as directory:
        home = Path(directory)
        for name in ("auth.json",):
            source = real_home / name
            if source.exists():
                shutil.copy2(source, home / name)
                (home / name).chmod(0o600)
        (home / "config.yaml").write_text(
            "model:\n  default: gpt-5.3-codex-spark\n  provider: openai-codex\n"
        )
        os.environ["HERMES_HOME"] = str(home)
        from hermes_voice.hermes_adapter import HermesAdapter
        from hermes_voice.server import Job

        stamps = []
        start = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()

        class ProbeJob(Job):
            def emit_text(self, delta):
                super().emit_text(delta)
                if isinstance(delta, str) and delta:
                    stamps.append(
                        (
                            time.perf_counter() - start,
                            datetime.now(timezone.utc).isoformat(),
                            len(self.stream_snapshot()["text"]),
                        )
                    )

        job = ProbeJob(uuid.uuid4().hex, "probe", False, home, stream=True)
        config = {
            "model": "gpt-5.3-codex-spark",
            "fast_model": "gpt-5.3-codex-spark",
            "provider": "openai-codex",
        }
        logging.disable(logging.CRITICAL)
        try:
            # Suppress upstream logs entirely; never publish raw exceptions/content.
            with (
                open(os.devnull, "w") as sink,
                contextlib.redirect_stdout(sink),
                contextlib.redirect_stderr(sink),
            ):
                result = HermesAdapter().run(
                    "Write six short friendly sentences describing a fictional sunny garden. No tools.",
                    [],
                    False,
                    config,
                    job,
                    lambda *args: None,
                )
            final_s = time.perf_counter() - start
            final_at = datetime.now(timezone.utc).isoformat()
            final = result.get("final_response", "")
            partial = job.stream_snapshot()["text"]
            evidence = dict(
                model=config["model"],
                provider=config["provider"],
                started_at=started_at,
                first_delta_at=stamps[0][1] if stamps else None,
                final_at=final_at,
                first_delta_seconds=round(stamps[0][0], 4) if stamps else None,
                final_seconds=round(final_s, 4),
                callback_count=len(stamps),
                partial_precedes_final=bool(stamps and stamps[0][0] < final_s),
                first_delta_characters=stamps[0][2] if stamps else 0,
                first_delta_is_incomplete=bool(stamps and stamps[0][2] < len(final)),
                final_extends_stream=final.startswith(partial),
                stream_characters=len(partial),
                final_characters=len(final),
                tools_count=len(job.agent.tools or []),
                conversation_calls=1,
            )
            print(json.dumps(evidence, indent=2))
        except Exception as exc:
            print(json.dumps({"probe_failed": True, "error_type": type(exc).__name__}))
            raise SystemExit(1) from None
        finally:
            job.close_stream()


if __name__ == "__main__":
    run()
