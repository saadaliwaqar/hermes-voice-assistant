"""Disposable setup probe entrypoint; executed only in a bounded subprocess."""

import json
import sys


def test_agent(model, provider):
    # Keep this boundary aligned with hermes_adapter.py's runtime resolution.
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent

    runtime = resolve_runtime_provider(requested=provider or None, target_model=model)
    agent = AIAgent(
        model=model,
        provider=runtime["provider"],
        requested_provider=provider or None,
        api_key=runtime.get("api_key"),
        base_url=runtime.get("base_url"),
        api_mode=runtime.get("api_mode"),
        enabled_toolsets=[],
        max_iterations=1,
        max_tokens=32,
        quiet_mode=True,
        save_trajectories=False,
        verbose_logging=False,
        session_db=None,
        skip_context_files=True,
        skip_memory=True,
        skip_background_review=True,
        checkpoints_enabled=False,
        platform="hermes-voice-setup",
        ephemeral_system_prompt="Reply with OK only. You have no tools. This is a connection test.",
    )
    if getattr(agent, "tools", None):
        raise RuntimeError("Unexpected tools; refusing model test")
    result = agent.run_conversation(
        user_message="Reply with OK only.",
        conversation_history=[],
    )
    return bool(
        isinstance(result, dict)
        and not result.get("error")
        and str(result.get("final_response") or "").strip()
    )


def main():
    try:
        payload = json.loads(sys.stdin.buffer.read(4096))
        ok = test_agent(payload["model"], payload["provider"])
    except BaseException:
        # Never emit exception details or model output across the subprocess boundary.
        ok = False
    raise SystemExit(0 if ok else 1)
