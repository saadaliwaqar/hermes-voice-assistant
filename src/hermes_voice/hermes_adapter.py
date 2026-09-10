"""Internal Hermes API boundary; tested against revision 21b2095d00 only."""

import inspect
import sys

from .config import source_path


def _stream_options(agent_type, worker, job):
    # Inspect before construction: never retry a conversation to add streaming.
    # An opaque **kwargs wrapper is not evidence of native callback support.
    if worker or not getattr(job, "stream", False):
        return {}
    try:
        parameter = inspect.signature(agent_type).parameters.get("stream_delta_callback")
    except (TypeError, ValueError):
        return {}
    if parameter is None or parameter.kind == inspect.Parameter.POSITIONAL_ONLY:
        return {}
    return {"stream_delta_callback": job.emit_text}


class HermesAdapter:
    def run(self, text, history, worker, settings, job, ask):
        source = source_path()
        if not (source / "run_agent.py").is_file():
            raise RuntimeError("Hermes unavailable. Set HERMES_SOURCE to your installation.")
        if str(source) not in sys.path:
            sys.path.insert(0, str(source))
        from gateway.hosted_room_execution_policy import (
            RoomExecutionPolicy,
            bind_room_execution_policy,
            reset_room_execution_policy,
        )
        from gateway.session_context import clear_session_vars, set_session_vars
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from run_agent import AIAgent
        from tools import approval, terminal_tool

        if worker and approval._YOLO_MODE_FROZEN:
            raise RuntimeError("Worker refused inherited YOLO mode; use manual Hermes approvals.")
        toolsets = ["terminal", "file", "web", "clarify"] if worker else []
        from hermes_constants import get_hermes_home

        home = get_hermes_home()
        profile = home.name if home.parent.name == "profiles" else "default"
        policy = RoomExecutionPolicy(
            version=1,
            target_profile=profile,
            enabled_toolsets=tuple(toolsets),
            approval_mode="manual",
            max_iterations=15,
            policy_digest="hermes-voice-manual",
        )
        token = bind_room_execution_policy(policy)
        interactive = approval.set_hermes_interactive_context(True)
        session_tokens = set_session_vars(
            session_key=job.id, session_id=job.id, cwd=str(job.cwd), cron_session=""
        )
        previous = terminal_tool._get_approval_callback()
        terminal_tool.set_approval_callback(
            lambda command, description="", **kw: (
                "once" if ask("approval", {"command": str(command)[:12000]}) is True else "deny"
            )
        )
        try:
            model = (
                (settings["fast_model"] or settings["model"]) if not worker else settings["model"]
            )
            runtime = resolve_runtime_provider(
                requested=settings["provider"] or None, target_model=model or None
            )

            def clarify(question, choices=None, multi_select=False, questions=None):
                if questions or multi_select:
                    return "Unsupported question format; ask one question at a time."
                answer = ask("question", {"question": str(question)[:12000]})
                return (
                    answer
                    if isinstance(answer, str) and answer.strip()
                    else "No answer received. Do not proceed or guess."
                )

            agent = AIAgent(
                **_stream_options(AIAgent, worker, job),
                model=model,
                provider=runtime["provider"],
                requested_provider=settings["provider"] or None,
                api_key=runtime.get("api_key"),
                base_url=runtime.get("base_url"),
                api_mode=runtime.get("api_mode"),
                enabled_toolsets=toolsets,
                max_iterations=15 if worker else 2,
                max_tokens=1600,
                quiet_mode=True,
                session_id=job.id,
                platform="hermes-voice",
                skip_context_files=True,
                skip_memory=True,
                skip_background_review=True,
                clarify_callback=clarify,
                ephemeral_system_prompt=(
                    "You are a concise voice assistant. Never claim unverified actions. "
                    "Do not modify Hermes configuration or bypass security. "
                    + (
                        "Execute only the explicitly requested task. Ask before consequential actions."
                        if worker
                        else "You have no tools. For actions or current facts, tell the user to use Send to worker."
                    )
                ),
            )
            job.agent = agent
            agent.session_cwd = str(job.cwd)
            if not worker and getattr(agent, "tools", None):
                raise RuntimeError("Chat unexpectedly has tools; refusing.")
            if job.cancelled.is_set():
                return ""
            result = agent.run_conversation(
                user_message=text, conversation_history=history, task_id=job.id
            )
            if not result or result.get("error"):
                raise RuntimeError(
                    "Hermes request failed. Check provider authentication and model settings."
                )
            return result
        finally:
            terminal_tool.set_approval_callback(previous)
            clear_session_vars(session_tokens)
            approval.reset_hermes_interactive_context(interactive)
            reset_room_execution_policy(token)
