import time

from hermes_voice.storage import Store


def test_restart_interrupts_never_replays(tmp_path):
    path = tmp_path / "history.sqlite3"
    first = Store(path)
    sid = first.create("test")["id"]
    first.execute(
        "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
        ("task", sid, "side effect", "running", None, None, time.time(), 1),
    )
    first.save_history(sid, "chat", [{"role": "user", "content": "private"}])
    first.db.close()
    recovered = Store(path)
    assert recovered.rows("SELECT status FROM tasks")[0]["status"] == "interrupted"
    assert recovered.history(sid, "chat")[0]["content"] == "private"
    assert recovered.history(sid, "worker") == []
    assert not recovered.session(sid)["busy"]


def test_settings_never_returns_unknown_secret(tmp_path, monkeypatch):
    from hermes_voice.config import Settings

    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "missing"))
    (tmp_path / "settings.json").write_text('{"api_key":"hidden","model":"chosen"}')
    public = Settings(tmp_path).public()
    assert public["model"] == "chosen"
    assert "hidden" not in str(public)
