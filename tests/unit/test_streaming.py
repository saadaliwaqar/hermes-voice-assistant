from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from hermes_voice.server import Job, Message


def test_stream_strict_opt_in():
    assert Message(text="hi").stream is False
    assert Message(text="hi", stream=True).stream is True
    for value in (1, "true", None, [], {}):
        with pytest.raises(ValidationError):
            Message(text="hi", stream=value)


def test_stream_bounded_thread_safe_and_controls(tmp_path):
    job = Job("task", "session", False, tmp_path, stream=True)
    for value in (None, {}, 2, False, ""):
        job.emit_text(value)
    assert job.stream_snapshot()["revision"] == 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(job.emit_text, ["x" * 100] * 1100))
    assert job.stream_snapshot() == {
        "task_id": "task",
        "session_id": "session",
        "text": "x" * 100000,
        "revision": 1000,
    }
    job.cancelled.set()
    job.emit_text("late")
    assert job.stream_snapshot() is None


@pytest.mark.parametrize("worker,stream", [(True, True), (False, False)])
def test_stream_never_worker_or_default(tmp_path, worker, stream):
    job = Job("task", "session", worker, tmp_path, stream=stream)
    job.emit_text("private")
    assert job.stream_snapshot() is None


def test_closed_job_ignores_late_callback(tmp_path):
    job = Job("task", "session", False, tmp_path, stream=True)
    job.emit_text("hello")
    job.close_stream()
    job.emit_text("late")
    assert job.stream_snapshot() is None
