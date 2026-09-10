"""Real loopback sockets: ASGI in-memory transports hide disconnects."""

import asyncio
import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from hermes_voice.server import create_app
from hermes_voice.speech import Speech


@pytest.mark.parametrize(
    "endpoint,payload",
    [
        ("/api/synthesize", {"text": "cancel this"}),
        ("/api/voice-preview", {"provider": "edge", "voice": "en-US-AriaNeural"}),
    ],
)
def test_disconnected_speech_cancelled_without_affecting_next_request(
    tmp_path, monkeypatch, endpoint, payload
):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "empty-home"))
    entered, cancelled = threading.Event(), threading.Event()
    calls = []

    async def synth(self, *args, **kwargs):
        calls.append(args)
        if len(calls) == 1:
            entered.set()
            try:
                await asyncio.sleep(20)
            except asyncio.CancelledError:
                cancelled.set()
                raise
        return b"ID3-test"

    monkeypatch.setattr(Speech, "synthesize", synth)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(create_app(tmp_path, object()), log_level="error", lifespan="on")
    )
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        body = json.dumps(payload).encode()
        with socket.create_connection(("127.0.0.1", port), timeout=3) as client:
            client.sendall(
                (
                    f"POST {endpoint} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                    f"Content-Type: application/json\r\nX-Hermes-Voice: browser\r\n"
                    f"Content-Length: {len(body)}\r\n\r\n"
                ).encode()
                + body
            )
            assert entered.wait(3)
        assert cancelled.wait(1), "disconnect left synthesis running"
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
            response = client.post(endpoint, json=payload, headers={"X-Hermes-Voice": "browser"})
            assert response.status_code == 200 and response.content == b"ID3-test"
            assert response.headers["content-type"] == "audio/mpeg"
            assert client.get("/api/sessions").json() == {"sessions": []}
    finally:
        server.should_exit = True
        thread.join(2)
        if thread.is_alive():
            server.force_exit = True
            thread.join(2)
        listener.close()
        assert not thread.is_alive()
