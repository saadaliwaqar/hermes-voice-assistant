import asyncio
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from . import __version__
from .config import Settings, data_path
from .hermes_adapter import HermesAdapter
from .setup import SetupService
from .speech import PREVIEW_TEXT, Speech, SpeechError, audio_mime
from .storage import Store, ident


class BrowserStaticFiles(StaticFiles):
    """Keep browser assets independent of OS/Windows registry MIME mappings."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        media_type = {
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
        }.get(Path(full_path).suffix.lower())
        if media_type is not None and response.status_code != 304:
            response.media_type = media_type
            response.headers["content-type"] = f"{media_type}; charset=utf-8"
        return response


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionCreate(Model):
    title: str = Field(default="New session", min_length=1, max_length=160)


class SessionPatch(Model):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    archived: StrictBool | None = None


class Message(Model):
    text: str = Field(min_length=1, max_length=12000)
    worker: StrictBool = False
    stream: StrictBool = False


class Approval(Model):
    approved: StrictBool
    answer: str | None = Field(default=None, max_length=12000)


class SettingsPatch(Model):
    model: str | None = Field(default=None, max_length=200, pattern=r"^[a-zA-Z0-9._:/-]*$")
    provider: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9._-]*$")
    fast_model: str | None = Field(default=None, max_length=200, pattern=r"^[a-zA-Z0-9._:/-]*$")
    voice_provider: Literal["none", "edge", "elevenlabs", "openai", "piper"] | None = None
    voice: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]*$")
    language: str | None = Field(default=None, max_length=20, pattern=r"^[a-zA-Z-]+$")


VoiceProvider = Literal["none", "edge", "elevenlabs", "openai", "piper"]


class SetupModelTest(Model):
    model: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9._:/-]+$")
    provider: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")


class VoicePreview(Model):
    provider: Literal["edge", "elevenlabs", "openai", "piper"]
    voice: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class Synthesis(Model):
    text: str = Field(min_length=1, max_length=4000)
    voice: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]*$")
    rate: float | None = Field(default=None, ge=0.5, le=2)


@dataclass
class Job:
    id: str
    session_id: str
    worker: bool
    cwd: Path
    cancelled: threading.Event = field(default_factory=threading.Event)
    agent: object = None
    task: object = None
    stream: bool = False
    _text: str = field(default="", init=False, repr=False)
    _revision: int = field(default=0, init=False)
    _stream_closed: bool = field(default=False, init=False)
    _stream_lock: object = field(default_factory=threading.Lock, init=False, repr=False)

    def emit_text(self, delta):
        """Only native visible-text callbacks belong here; never events/errors."""
        if not isinstance(delta, str) or not delta:
            return
        with self._stream_lock:
            if not self.stream or self.worker or self.cancelled.is_set() or self._stream_closed:
                return
            delta = delta[: 100000 - len(self._text)]
            if delta:
                self._text += delta
                self._revision += 1

    def stream_snapshot(self):
        with self._stream_lock:
            if not self.stream or self.worker or self.cancelled.is_set() or self._stream_closed:
                return None
            return dict(
                task_id=self.id,
                session_id=self.session_id,
                text=self._text,
                revision=self._revision,
            )

    def close_stream(self):
        with self._stream_lock:
            self._stream_closed = True
            self._text = ""


def create_app(data_dir=None, adapter=None):
    root = Path(data_dir) if data_dir is not None else data_path()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    store = Store(root / "history.sqlite3")
    settings = Settings(root)
    (root / "history.sqlite3").chmod(0o600)
    adapter = adapter or HermesAdapter()
    speech = Speech()
    setup = SetupService(root, settings)
    jobs = {}
    pending = {}

    async def cancel(job):
        job.cancelled.set()
        job.close_stream()
        store.execute(
            "UPDATE tasks SET status='cancelling' WHERE id=? AND status='running'",
            (job.id,),
        )
        for record, future in list(pending.values()):
            if record["task_id"] == job.id and not future.done():
                future.set_result(None)
        if job.agent:
            await asyncio.to_thread(job.agent.interrupt, hard_cancel=True)

    @asynccontextmanager
    async def lifespan(app):
        yield
        for job in list(jobs.values()):
            await cancel(job)
        if jobs:
            await asyncio.wait([j.task for j in list(jobs.values())], timeout=5)
        # Threads may still be unwinding: keep the connection until process exit.

    app = FastAPI(lifespan=lifespan)
    app.state.store = store

    @app.middleware("http")
    async def security(request, call_next):
        host = request.headers.get("host", "")
        try:
            parsed = urlsplit("http://" + host)
            valid = (
                parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                and parsed.username is None
                and not parsed.path
            )
            _ = parsed.port
        except ValueError:
            valid = False
        if not valid:
            return JSONResponse({"detail": "Invalid host"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
        if (
            request.method not in {"GET", "HEAD", "OPTIONS"}
            and request.headers.get("x-hermes-voice") != "browser"
        ):
            return JSONResponse({"detail": "Missing browser mutation header"}, status_code=403)
        try:
            size = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "Invalid content length"}, status_code=400)
        if size > 16_000_000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            limit = 16_000_000 if request.url.path == "/api/transcribe" else 64_000
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    return JSONResponse({"detail": "Request too large"}, status_code=413)
                body.extend(chunk)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation(request, exc):
        return JSONResponse({"detail": "Invalid request fields or bounds"}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        return JSONResponse(
            {"detail": "Internal error; operation did not complete."}, status_code=500
        )

    def session(sid):
        result = store.session(sid)
        if not result:
            raise HTTPException(404, "Session not found")
        return result

    def snapshot(sid):
        return {
            "session": session(sid),
            "messages": store.rows(
                "SELECT id,role,content,created_at FROM messages WHERE session_id=? ORDER BY created_at",
                (sid,),
            ),
            "tasks": store.rows(
                "SELECT * FROM tasks WHERE session_id=? ORDER BY created_at", (sid,)
            ),
            "streams": [
                item
                for job in jobs.values()
                if job.session_id == sid and (item := job.stream_snapshot()) is not None
            ],
            "approvals": [
                r for r, f in pending.values() if r["session_id"] == sid and not f.done()
            ],
        }

    @app.get("/api/health")
    async def health():
        public = settings.public()
        return dict(
            ok=True,
            service="hermes-voice",
            version=__version__,
            **{k: public[k] for k in ("hermes_available", "model", "provider")},
        )

    @app.get("/api/setup")
    async def get_setup():
        return await setup.status()

    @app.post("/api/setup/test-model")
    async def test_setup_model(value: SetupModelTest):
        return await setup.test_model(value.model, value.provider)

    @app.post("/api/setup/complete")
    async def complete_setup():
        return setup.complete()

    @app.get("/api/settings")
    async def get_settings():
        return settings.public()

    @app.patch("/api/settings")
    async def update_settings(value: SettingsPatch):
        return settings.update(value.model_dump(exclude_none=True))

    @app.get("/api/sessions")
    async def sessions():
        return {
            "sessions": [
                store.session(r["id"])
                for r in store.rows("SELECT id FROM sessions ORDER BY updated_at DESC")
            ]
        }

    @app.post("/api/sessions")
    async def create(value: SessionCreate):
        return store.create(value.title)

    @app.get("/api/sessions/{sid}")
    async def get_session(sid: str):
        return snapshot(sid)

    @app.patch("/api/sessions/{sid}")
    async def update_session(sid: str, value: SessionPatch):
        session(sid)
        for key, val in value.model_dump(exclude_none=True).items():
            store.execute(
                f"UPDATE sessions SET {key}=?,updated_at=? WHERE id=?",
                (val, time.time(), sid),
            )
        return session(sid)

    @app.delete("/api/sessions/{sid}")
    async def delete_session(sid: str):
        if session(sid)["busy"]:
            raise HTTPException(409, "Session has active work")
        store.execute("DELETE FROM sessions WHERE id=?", (sid,))
        return {"ok": True}

    @app.get("/api/sessions/{sid}/export")
    async def export(sid: str):
        data = snapshot(sid)
        return JSONResponse(
            data,
            headers={
                "Content-Disposition": f'attachment; filename="session-{data["session"]["id"]}.json"'
            },
        )

    async def ask(job, kind, payload):
        if job.cancelled.is_set():
            return None
        aid = ident()
        future = asyncio.get_running_loop().create_future()
        pending[aid] = (
            {
                "id": aid,
                "session_id": job.session_id,
                "task_id": job.id,
                "kind": kind,
                **payload,
            },
            future,
        )
        try:
            return await asyncio.wait_for(future, 120)
        except (TimeoutError, asyncio.CancelledError):
            return None
        finally:
            pending.pop(aid, None)

    async def execute(job, text, config):
        lane = "worker" if job.worker else "chat"
        history = store.history(job.session_id, lane)
        loop = asyncio.get_running_loop()

        def ask_sync(kind, payload):
            future = asyncio.run_coroutine_threadsafe(ask(job, kind, payload), loop)
            try:
                return future.result(125)
            except Exception:
                future.cancel()
                return None

        try:
            result = await asyncio.to_thread(
                adapter.run, text, history, job.worker, config, job, ask_sync
            )
            if job.cancelled.is_set():
                store.execute(
                    "UPDATE tasks SET status='cancelled',error='Cancellation requested. Partial effects may remain.' WHERE id=?",
                    (job.id,),
                )
                return
            output = (
                str(result.get("final_response", ""))
                if isinstance(result, dict)
                else str(result or "")
            )
            if not output:
                raise RuntimeError("Agent returned no response")
            if len(output) > 100000:
                raise RuntimeError("Agent response exceeded limit")
            new_history = result.get("messages") if isinstance(result, dict) else None
            store.save_history(
                job.session_id,
                lane,
                new_history
                or history
                + [
                    {"role": "user", "content": text},
                    {"role": "assistant", "content": output},
                ],
            )
            store.message(job.session_id, "assistant", output)
            store.execute(
                "UPDATE tasks SET status='completed',result=? WHERE id=?",
                (output, job.id),
            )
        except Exception:
            # Provider exceptions may include request headers or secrets.
            message = "Request failed. Check Hermes runtime dependencies, model settings and provider authentication."
            if not job.worker and not job.cancelled.is_set():
                store.message(job.session_id, "system", message)
            store.execute(
                "UPDATE tasks SET status=?,error=? WHERE id=?",
                (
                    "cancelled" if job.cancelled.is_set() else "failed",
                    message[:400],
                    job.id,
                ),
            )
        finally:
            job.close_stream()
            jobs.pop(job.id, None)

    @app.post("/api/sessions/{sid}/messages", status_code=202)
    async def message(sid: str, value: Message):
        session(sid)
        if not value.text.strip():
            raise HTTPException(422, "Text must not be blank")
        if any(j.session_id == sid and j.worker == value.worker for j in jobs.values()):
            raise HTTPException(409, "This session lane is busy")
        if len(jobs) >= 8:
            raise HTTPException(429, "Too many concurrent requests")
        job = Job(ident(), sid, value.worker, root, stream=value.stream and not value.worker)
        store.message(sid, "user", value.text)
        store.execute(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
            (job.id, sid, value.text, "running", None, None, time.time(), value.worker),
        )
        jobs[job.id] = job
        job.task = asyncio.create_task(execute(job, value.text, dict(settings.values)))
        return {"id": job.id, "status": "running"}

    @app.post("/api/sessions/{sid}/stop")
    async def stop(sid: str):
        session(sid)
        for job in list(jobs.values()):
            if job.session_id == sid and not job.worker:
                await cancel(job)
        return {"ok": True}

    @app.post("/api/tasks/{tid}/cancel")
    async def cancel_task(tid: str):
        rows = store.rows("SELECT * FROM tasks WHERE id=?", (tid,))
        if not rows:
            raise HTTPException(404, "Task not found")
        job = jobs.get(tid)
        if not job or not job.worker:
            raise HTTPException(409, "Worker task is not active")
        await cancel(job)
        return {"ok": True, "status": "cancelling"}

    @app.post("/api/approvals/{aid}")
    async def approve(aid: str, value: Approval):
        item = pending.get(aid)
        if not item or item[1].done():
            raise HTTPException(409, "Approval expired or already answered")
        record, future = item
        job = jobs.get(record["task_id"])
        if not job or job.cancelled.is_set() or job.session_id != record["session_id"]:
            raise HTTPException(409, "Approval task is inactive")
        if record["kind"] == "question":
            future.set_result(value.answer if value.approved else None)
        else:
            future.set_result(value.approved)
        return {"ok": True}

    @app.post("/api/transcribe")
    async def transcribe(audio: UploadFile = File(...)):
        data = await audio.read(12_000_001)
        await audio.close()
        if not data or len(data) > 12_000_000:
            raise HTTPException(413, "Audio must be between 1 byte and 12 MB")
        try:
            return {
                "text": await asyncio.to_thread(
                    speech.transcribe, data, settings.values["language"]
                )
            }
        except Exception:
            raise HTTPException(
                503,
                "Local transcription failed. Install speech dependencies; first use downloads the base model.",
            )

    @app.get("/api/voices")
    async def voices(provider: VoiceProvider):
        return await speech.voices(provider)

    async def speech_response(request, text, config, voice=None, rate=None):
        # FastAPI has consumed the JSON body. Only this watcher reads the
        # remaining receive channel; an aborted fetch must not keep TTS alive.
        async def disconnected():
            while True:
                if (await request.receive())["type"] == "http.disconnect":
                    return

        work = asyncio.create_task(speech.synthesize(text, config, voice, rate))
        watcher = asyncio.create_task(disconnected())
        try:
            await asyncio.wait((work, watcher), return_when=asyncio.FIRST_COMPLETED)
            if watcher.done():
                # There is no client to deliver this to. Avoid an ASGI error
                # while the finally block cancels and drains provider awaits.
                return Response(status_code=499)
            return Response(
                await work,
                media_type=audio_mime(config["voice_provider"]),
            )
        except SpeechError as exc:
            raise HTTPException(503, str(exc)) from None
        except Exception:
            raise HTTPException(503, "Speech provider failed; no fallback used.") from None
        finally:
            work.cancel()
            watcher.cancel()
            await asyncio.gather(work, watcher, return_exceptions=True)

    @app.post("/api/voice-preview")
    async def voice_preview(value: VoicePreview, request: Request):
        return await speech_response(
            request, PREVIEW_TEXT, {"voice_provider": value.provider, "voice": value.voice}
        )

    @app.post("/api/synthesize")
    async def synthesize(value: Synthesis, request: Request):
        return await speech_response(
            request, value.text, dict(settings.values), value.voice, value.rate
        )

    static = Path(__file__).parent / "static"
    if static.is_dir():
        app.mount("/static", BrowserStaticFiles(directory=static), name="assets")
        app.mount("/", BrowserStaticFiles(directory=static, html=True), name="static")
    return app


def main():
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="Hermes Voice local dashboard")
    parser.add_argument("--port", type=int, default=8780)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be 1–65535")
    uvicorn.run(
        create_app(), host="127.0.0.1", port=args.port, proxy_headers=False, access_log=False
    )


if __name__ == "__main__":
    main()
