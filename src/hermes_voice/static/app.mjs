import { SpeechGate, encodeWav } from "./voice-core.mjs";
import { createVoiceOrb } from "./orb.mjs";
import { createSetupWizard } from "./setup.mjs";
import { SpeechPlayback } from "./speech-playback.mjs";
const $ = (id) => document.getElementById(id);
const orb = createVoiceOrb($("voice-orb"), $("voice-orb-stage"));
document.addEventListener("pointerdown", () => orb.prepare(), { once: true });
$("orb-toggle").onclick = () => {
  const compact = $("voice-orb-stage").dataset.compact !== "true";
  $("voice-orb-stage").dataset.compact = String(compact);
  $("orb-toggle").textContent = compact ? "Show visual" : "Hide visual";
  $("orb-toggle").setAttribute("aria-expanded", String(!compact));
};
const state = {
  sessions: [],
  active: null,
  epoch: 0,
  settings: { voice_provider: "none" },
  details: new Map(),
  drafts: new Map(),
  seen: new Map(),
  unread: new Set(),
  pendingSpeech: new Map(),
  stream: null,
  audio: null,
  audioURL: null,
  audioEpoch: 0,
  preview: null,
  speechQueue: [],
  speechPreparing: false,
  mic: null,
  micEpoch: 0,
  transcribing: false,
  sending: false,
};
let setupWizard = null;
const terminalStates = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "done",
]);
function node(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function notify(message) {
  $("notice-text").textContent = message;
  $("notice").hidden = false;
}
function stored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
async function api(path, { method = "GET", body, signal, blob = false } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-Hermes-Voice"] = "browser";
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { method, headers, body, signal });
  if (!response.ok) {
    let detail;
    try {
      detail = (await response.json()).detail;
    } catch {}
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status})`,
    );
  }
  return blob
    ? response.blob()
    : response.status === 204
      ? null
      : response.json();
}
function safeRun(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      if (error.name !== "AbortError")
        notify(error.message || "Something went wrong. Please try again.");
    }
  };
}
function button(text, action, cls) {
  const b = node("button", text, cls);
  b.type = "button";
  b.addEventListener(
    "click",
    safeRun(async () => {
      b.disabled = true;
      try {
        await action();
      } finally {
        b.disabled = false;
      }
    }),
  );
  return b;
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme").textContent = theme === "core" ? "Daylight" : "Core";
  $("theme").setAttribute(
    "aria-label",
    `Switch to ${theme === "core" ? "Daylight" : "Core"} theme`,
  );
  store("hermes-theme", theme);
}
setTheme(stored("hermes-theme", "core") === "daylight" ? "daylight" : "core");
$("theme").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "core" ? "daylight" : "core",
  );
$("dismiss").onclick = () => ($("notice").hidden = true);
function syncOrb() {
  orb.setPhase(
    state.audio && !state.audio.paused
      ? "speaking"
      : state.transcribing || state.speechPreparing || chatBusy()
        ? "thinking"
        : state.mic
          ? "listening"
          : "standby",
  );
}
function voiceStatus(title, detail) {
  orb.setPhase(
    title.startsWith("Speaking")
      ? "speaking"
      : /Listening/.test(title)
        ? "listening"
        : /Transcribing|Preparing speech|Message sent/.test(title)
          ? "thinking"
          : "standby",
  );
  $("voice-state").textContent = title;
  $("voice-detail").textContent = detail;
}
function stopPlayback() {
  state.stream = null;
  $("stream-preview")?.remove();
  speechPlayback.stop();
  setupWizard?.stopMedia();
  state.speechQueue = [];
  state.pendingSpeech.clear();
  state.speechPreparing = false;
  if (state.preview) {
    state.preview.abort();
    state.preview = null;
    $("voice-preview-status").textContent =
      "Preview stopped. Changes are not saved.";
    updatePreviewControls();
  }
  orb.disconnect();
  state.audioEpoch++;
  if (state.audio) {
    state.audio.pause();
    state.audio.src = "";
    state.audio = null;
  }
  if (state.audioURL) {
    URL.revokeObjectURL(state.audioURL);
    state.audioURL = null;
  }
}
function stopMic() {
  state.micEpoch++;
  const mic = state.mic;
  state.mic = null;
  if (mic) {
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.worklet.port.onmessage = null;
    mic.source.disconnect();
    mic.worklet.disconnect();
    mic.gain.disconnect();
    mic.context.close().catch(() => {});
  }
  state.transcribing = false;
  document.body.classList.remove("listening");
  $("microphone").textContent = "Start mic";
  voiceStatus(
    "Microphone off",
    "Text chat is always available. Workers continue independently.",
  );
}
function stopLocal() {
  setupWizard?.stopMedia();
  state.speechQueue = [];
  stopPlayback();
  stopMic();
  state.pendingSpeech.clear();
}
function chatBusy() {
  return (
    Boolean(state.stream) ||
    (state.sending && $("stream-replies").checked) ||
    (state.details.get(state.active)?.tasks || []).some(
      (t) => !t.worker && !terminalStates.has(t.status),
    )
  );
}
function drainSpeech() {
  if (
    !state.speechQueue.length ||
    state.preview ||
    $("settings-dialog").open ||
    $("setup-dialog")?.open ||
    state.audio ||
    state.speechPreparing ||
    state.transcribing ||
    state.mic?.gate.active ||
    chatBusy()
  )
    return;
  const item = state.speechQueue.shift();
  if (item.id === state.active && item.epoch === state.epoch)
    speak(item.text, item.id).catch((e) => notify(e.message));
}
const speechPlayback = new SpeechPlayback({
  synthesize: (text, { signal, voice }) =>
    api("/api/synthesize", {
      method: "POST",
      body: { text, voice },
      signal,
      blob: true,
    }),
  onState: ({ phase, audio, reason }) => {
    // Busy spans the WHOLE reply, including gaps waiting on a prefetched chunk.
    state.speechPreparing = phase !== "idle";
    if (state.audio !== audio) {
      orb.disconnect();
      state.audio = audio;
      if (audio) orb.attach(audio);
    }
    if (phase === "playing")
      voiceStatus("Speaking…", "Interrupt stops playback, not your workers.");
    else if (phase === "preparing")
      voiceStatus(
        "Preparing speech…",
        state.stream
          ? "Streaming trial · waiting for the next complete sentence."
          : "Sequential speech chunks from the completed reply.",
      );
    else {
      state.mic?.gate.reset();
      if (reason !== "stopped")
        voiceStatus(
          chatBusy() ? "Message sent" : state.mic ? "Listening…" : "Ready",
          reason === "completed"
            ? "Speech finished."
            : "Speech stopped. Use Read aloud to retry; the full reply remains visible.",
        );
    }
  },
  onError: (error) => {
    state.speechQueue = [];
    state.pendingSpeech.clear();
    notify(
      `Speech unavailable: ${error.message}. The full reply remains visible; use Read aloud to retry.`,
    );
  },
});
async function speak(text, sessionId = state.active) {
  if (!text || sessionId !== state.active) return;
  stopPlayback();
  if (state.settings.voice_provider === "none") {
    notify(
      "Speech is off. Choose a speech provider in Settings, or continue reading in text.",
    );
    return;
  }
  return speechPlayback.start(text, { voice: state.settings.voice });
}
// Browser-only trial preference. The query is an explicit opt-in, never a default.
if (new URLSearchParams(location.search).get("stream") === "1") {
  store("hermes-stream-replies", "1");
  const url = new URL(location.href);
  url.searchParams.delete("stream");
  history.replaceState(history.state, "", url);
}
$("stream-replies").checked = stored("hermes-stream-replies", "0") === "1";
$("stream-replies").onchange = () => {
  store("hermes-stream-replies", $("stream-replies").checked ? "1" : "0");
  stopPlayback();
  syncOrb();
};
$("auto-speech").onchange = () => {
  if (!$("auto-speech").checked) {
    stopPlayback();
    syncOrb();
  }
};
$("worker-mode").onchange = () => {
  if ($("stream-replies").checked || state.stream) {
    stopPlayback();
    syncOrb();
  }
};
function renderStream() {
  $("stream-preview")?.remove();
  const s = state.stream;
  if (!s || s.id !== state.active || !s.text) return;
  const article = node("article", undefined, "stream-preview");
  article.id = "stream-preview";
  article.append(
    node("strong", "Hermes · generating (trial)"),
    node("div", s.text, "stream-preview-text"),
  );
  $("messages").append(article);
}
function consumeStream(id, detail) {
  const s = state.stream;
  if (
    !s ||
    s.id !== id ||
    id !== state.active ||
    s.epoch !== state.epoch ||
    s.token !== state.audioEpoch
  )
    return;
  const task = (detail.tasks || []).find((t) => t.id === s.task && !t.worker);
  if (task && terminalStates.has(task.status)) {
    state.stream = null;
    $("stream-preview")?.remove();
    if (
      ["completed", "done"].includes(task.status) &&
      typeof task.result === "string"
    )
      s.playback?.final(task.result);
    else {
      speechPlayback.stop();
      notify(
        task.error ||
          "Streaming reply stopped without a final result. Read the conversation or retry.",
      );
    }
    return;
  }
  const update = (detail.streams || []).find(
    (x) => x.task_id === s.task && x.session_id === id,
  );
  if (
    !update ||
    !Number.isInteger(update.revision) ||
    update.revision <= s.revision ||
    typeof update.text !== "string"
  )
    return;
  s.revision = update.revision;
  s.text = update.text;
  s.playback?.append(update.text);
}
function renderSessions() {
  const query = $("search").value.toLocaleLowerCase(),
    archived = $("show-archived").checked;
  const signature = JSON.stringify([
    query,
    archived,
    state.active,
    state.sessions.map((s) => [
      s.id,
      s.title,
      s.archived,
      s.busy,
      s.unread,
      state.unread.has(s.id),
    ]),
  ]);
  if ($("sessions").dataset.signature === signature) return;
  $("sessions").dataset.signature = signature;
  const frag = document.createDocumentFragment();
  for (const session of state.sessions.filter(
    (s) =>
      (archived || !s.archived) && s.title.toLocaleLowerCase().includes(query),
  )) {
    const b = button("", () => selectSession(session.id), "session");
    b.setAttribute("aria-current", String(session.id === state.active));
    b.append(node("span", session.title, "session-title"));
    const meta = node("span", undefined, "session-meta");
    meta.append(
      node(
        "span",
        session.archived
          ? "Archived"
          : session.busy
            ? "Working"
            : "Conversation",
      ),
    );
    if (state.unread.has(session.id) || session.unread)
      meta.append(node("span", "New result", "badge"));
    b.append(meta);
    frag.append(b);
  }
  if (!frag.childNodes.length)
    frag.append(
      node(
        "p",
        "No conversations match. Create one to get started.",
        "empty-small",
      ),
    );
  $("sessions").replaceChildren(frag);
}
function renderMessages(messages) {
  const box = $("messages"),
    bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const signature = JSON.stringify(messages.map((m) => [m.id, m.content]));
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  if (!messages.length) {
    box.replaceChildren();
    const welcome = node("div", undefined, "welcome");
    welcome.append(
      node("span", "READY WHEN YOU ARE", "eyebrow"),
      node("h2", "A conversation.\nA little more possibility."),
      node(
        "p",
        "Type a message below or start the microphone. For tool-enabled work, turn on Send to worker.",
      ),
    );
    box.append(welcome);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const m of messages) {
    const article = node(
        "article",
        undefined,
        `message ${m.role === "user" ? "user" : "assistant"}`,
      ),
      head = node("div", undefined, "message-head");
    head.append(
      node(
        "strong",
        m.role === "assistant" ? "Hermes" : m.role === "user" ? "You" : m.role,
      ),
    );
    if (m.created_at) {
      const date = new Date(
        typeof m.created_at === "number" ? m.created_at * 1000 : m.created_at,
      );
      if (!Number.isNaN(date.getTime()))
        head.append(
          node(
            "time",
            date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ),
        );
    }
    article.append(head, node("div", m.content || "", "message-body"));
    if (m.role === "assistant")
      article.append(
        button("Read aloud", () => speak(m.content), "read-button"),
      );
    frag.append(article);
  }
  box.replaceChildren(frag);
  if (bottom) box.scrollTop = box.scrollHeight;
  else $("latest").hidden = false;
}
function renderActivity(detail) {
  const taskSig = JSON.stringify(detail.tasks || []);
  if ($("tasks").dataset.signature !== taskSig) {
    $("tasks").dataset.signature = taskSig;
    $("tasks").replaceChildren();
    for (const task of detail.tasks || []) {
      const card = node("article", undefined, "task");
      card.append(node("span", task.status, "eyebrow"), node("h4", task.brief));
      if (task.result) {
        const result = node("details");
        result.append(
          node("summary", "View result"),
          node(
            "p",
            typeof task.result === "string"
              ? task.result
              : JSON.stringify(task.result, null, 2),
          ),
        );
        card.append(result);
      }
      if (task.error) card.append(node("p", task.error, "danger"));
      const actions = node("div", undefined, "task-actions");
      if (!terminalStates.has(task.status))
        actions.append(
          button("Cancel worker", () =>
            api(`/api/tasks/${encodeURIComponent(task.id)}/cancel`, {
              method: "POST",
            }),
          ),
        );
      if (task.result)
        actions.append(
          button("Read result", () =>
            speak(
              typeof task.result === "string"
                ? task.result
                : JSON.stringify(task.result),
            ),
          ),
        );
      card.append(actions);
      $("tasks").append(card);
    }
    if (!detail.tasks?.length)
      $("tasks").append(
        node(
          "p",
          "No workers yet. Enable “Send to worker” for a tool-enabled task.",
          "empty-small",
        ),
      );
  }
  $("task-count").textContent = detail.tasks?.length || 0;
  const approvals = detail.approvals || [],
    sig = JSON.stringify(approvals);
  if ($("approvals").dataset.signature !== sig) {
    $("approvals").dataset.signature = sig;
    $("approvals").replaceChildren();
    for (const approval of approvals) {
      const card = node("article", undefined, "approval");
      card.append(
        node("span", approval.kind, "eyebrow"),
        node("h4", approval.question || "Permission requested"),
      );
      if (approval.command) card.append(node("pre", approval.command));
      card.append(
        node(
          "p",
          `Worker ${approval.task_id || "foreground"} · This session`,
          "muted",
        ),
      );
      let answer;
      if (approval.question) {
        answer = node("input");
        answer.placeholder = "Optional answer";
        answer.setAttribute("aria-label", "Answer to approval question");
        card.append(answer);
      }
      const actions = node("div", undefined, "task-actions");
      for (const [label, approved] of [
        ["Approve", true],
        ["Deny", false],
      ])
        actions.append(
          button(
            label,
            async () => {
              await api(`/api/approvals/${encodeURIComponent(approval.id)}`, {
                method: "POST",
                body: { approved, answer: answer?.value || "" },
              });
              card.remove();
            },
            approved ? "primary" : "",
          ),
        );
      card.append(actions);
      $("approvals").append(card);
    }
    if (!approvals.length)
      $("approvals").append(
        node(
          "p",
          "No approvals waiting. Requests for permission appear here before you decide.",
          "empty-small",
        ),
      );
  }
  $("approval-count").textContent = approvals.length;
}
function renderDetail(detail) {
  $("session-title").textContent = detail.session.title;
  $("session-state").textContent = detail.session.archived
    ? "Archived conversation"
    : detail.session.busy
      ? "Work in progress · conversation and workers are separate"
      : "Conversation ready";
  $("archive-session").textContent = detail.session.archived
    ? "Unarchive"
    : "Archive";
  $("export-session").href =
    `/api/sessions/${encodeURIComponent(state.active)}/export`;
  $("delete-session").disabled = Boolean(detail.session.busy);
  renderMessages(detail.messages || []);
  renderStream();
  renderActivity({
    ...detail,
    tasks: (detail.tasks || []).filter(
      (t) => t.worker === undefined || Boolean(t.worker),
    ),
  });
}
function ingest(id, detail) {
  const previous = state.seen.get(id);
  const current = new Set(
    (detail.messages || [])
      .filter((m) => m.role === "assistant")
      .map((m) => m.id),
  );
  const newReplies = previous
    ? (detail.messages || []).filter(
        (m) => m.role === "assistant" && !previous.has(m.id),
      )
    : [];
  const before = state.details.get(id);
  const oldTasks = new Map((before?.tasks || []).map((t) => [t.id, t.status]));
  const completed = (detail.tasks || []).some(
    (t) =>
      terminalStates.has(t.status) &&
      oldTasks.has(t.id) &&
      oldTasks.get(t.id) !== t.status,
  );
  state.seen.set(id, current);
  state.details.set(id, detail);
  if (id !== state.active && (newReplies.length || completed))
    state.unread.add(id);
  if (id === state.active) {
    consumeStream(id, detail);
    renderDetail(detail);
    const pending = state.pendingSpeech.get(id);
    if (newReplies.length && pending === state.epoch) {
      state.pendingSpeech.delete(id);
      if ($("auto-speech").checked && state.settings.voice_provider !== "none")
        state.speechQueue.push({
          text: newReplies.at(-1).content,
          id,
          epoch: state.epoch,
        });
    }
  }
}
async function selectSession(id) {
  if (id === state.active) return;
  if (state.active) state.drafts.set(state.active, $("message-input").value);
  stopLocal();
  state.epoch++;
  state.active = id;
  $("message-input").value = state.drafts.get(id) || "";
  $("worker-mode").checked = false;
  store("hermes-active", id);
  state.unread.delete(id);
  $("messages").dataset.signature = "";
  $("messages").replaceChildren(
    node("p", "Loading conversation…", "empty-small"),
  );
  $("tasks").dataset.signature = "";
  $("approvals").dataset.signature = "";
  $("tasks").replaceChildren(node("p", "Loading workers…", "empty-small"));
  $("approvals").replaceChildren(
    node("p", "Loading approvals…", "empty-small"),
  );
  $("session-title").textContent =
    state.sessions.find((s) => s.id === id)?.title || "Loading conversation…";
  $("latest").hidden = true;
  renderSessions();
  const epoch = state.epoch;
  const detail = await api(`/api/sessions/${encodeURIComponent(id)}`);
  if (epoch !== state.epoch) return;
  state.seen.set(
    id,
    new Set(
      (detail.messages || [])
        .filter((m) => m.role === "assistant")
        .map((m) => m.id),
    ),
  );
  state.details.set(id, detail);
  renderDetail(detail);
  $("messages").scrollTop = $("messages").scrollHeight;
}
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const data = await api("/api/sessions");
    state.sessions = data.sessions || [];
    renderSessions();
    if (!state.active && state.sessions.length) {
      const saved = stored("hermes-active", "");
      await selectSession(
        state.sessions.some((s) => s.id === saved)
          ? saved
          : (state.sessions.find((s) => !s.archived) || state.sessions[0]).id,
      );
    }
    const epoch = state.epoch,
      ids = state.sessions.map((s) => s.id);
    for (const id of ids) {
      const detail = await api(`/api/sessions/${encodeURIComponent(id)}`);
      if (epoch !== state.epoch) break;
      ingest(id, detail);
    }
    renderSessions();
    drainSpeech();
    syncOrb();
    $("connection").textContent =
      state.settings.hermes_available === false
        ? "Service connected · Hermes unavailable"
        : "Local service connected";
    $("connection").classList.add("online");
  } catch (error) {
    $("connection").textContent = "Connection lost · retrying";
    $("connection").classList.remove("online");
    if (!state.sessions.length)
      notify(
        `${error.message}. Text and voice need the local service; reconnecting automatically.`,
      );
  } finally {
    polling = false;
    setTimeout(poll, state.stream ? 200 : 800);
  }
}
async function sendText(text, worker = $("worker-mode").checked) {
  text = text.trim();
  if (!text) return;
  if (!state.active) {
    notify("Create or select a conversation first.");
    return;
  }
  if (state.sending) return;
  const streaming = $("stream-replies").checked && !worker;
  if (streaming) stopPlayback();
  const id = state.active,
    epoch = state.epoch,
    speechToken = state.audioEpoch;
  state.sending = true;
  $("send").disabled = true;
  try {
    const ack = await api(`/api/sessions/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: { text, worker, ...(streaming ? { stream: true } : {}) },
    });
    if (id === state.active && epoch === state.epoch) {
      $("message-input").value = "";
      // Interrupt, setup, or manual playback may have superseded this send
      // while its HTTP response was pending. Never re-arm stale auto-speech.
      if (speechToken === state.audioEpoch) {
        if (streaming) {
          // Only the send acknowledgement grants ownership; snapshots never do.
          state.stream = {
            id,
            epoch,
            token: speechToken,
            task: ack.id,
            revision: -1,
            text: "",
            playback: null,
          };
          if (
            $("auto-speech").checked &&
            state.settings.voice_provider !== "none"
          )
            state.stream.playback = speechPlayback.startStream({
              voice: state.settings.voice,
            });
          const detail = state.details.get(id);
          if (detail) consumeStream(id, detail);
        } else state.pendingSpeech.set(id, epoch);
        voiceStatus(
          worker ? "Worker request sent" : "Message sent",
          "Waiting for the server. You can keep reading or switch sessions.",
        );
      }
    }
  } finally {
    state.sending = false;
    $("send").disabled = false;
  }
}
$("composer").addEventListener(
  "submit",
  safeRun(async (event) => {
    event.preventDefault();
    await sendText($("message-input").value);
  }),
);
$("message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});
$("search").oninput = renderSessions;
$("show-archived").onchange = renderSessions;
$("latest").onclick = () => {
  $("messages").scrollTop = $("messages").scrollHeight;
  $("latest").hidden = true;
};
$("messages").onscroll = () => {
  const b = $("messages");
  if (b.scrollHeight - b.scrollTop - b.clientHeight < 80)
    $("latest").hidden = true;
};
$("new-session").onclick = safeRun(async () => {
  if ($("stream-replies").checked || state.stream) stopLocal();
  const session = await api("/api/sessions", { method: "POST", body: {} });
  state.sessions.unshift(session);
  await selectSession(session.id);
  $("message-input").focus();
});
let action = null;
$("rename-session").onclick = () => openAction("rename");
$("archive-session").onclick = safeRun(async () => {
  if (!state.active) return;
  const id = state.active,
    s = state.details.get(id)?.session;
  await api(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { archived: !s?.archived },
  });
  const detail = await api(`/api/sessions/${encodeURIComponent(id)}`);
  if (id === state.active) ingest(id, detail);
  $("session-menu").open = false;
});
$("delete-session").onclick = () => openAction("delete");
function openAction(kind) {
  if (!state.active) return;
  action = { kind, id: state.active };
  $("action-title").textContent =
    kind === "rename" ? "Rename conversation" : "Delete conversation?";
  $("action-description").textContent =
    kind === "rename"
      ? "A clear title makes it easier to return to your work."
      : "This permanently removes this conversation and its stored history. Busy sessions cannot be deleted.";
  $("action-label").hidden = kind !== "rename";
  $("action-input").required = kind === "rename";
  $("action-input").value =
    state.details.get(state.active)?.session.title || "";
  $("action-confirm").textContent =
    kind === "rename" ? "Save title" : "Delete conversation";
  $("action-dialog").showModal();
  if (kind === "rename") $("action-input").select();
}
$("action-form").onsubmit = safeRun(async (event) => {
  event.preventDefault();
  if (!action) return;
  const { kind, id } = action;
  if (kind === "rename")
    await api(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { title: $("action-input").value.trim() },
    });
  else {
    await api(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === state.active) {
      stopLocal();
      state.epoch++;
      state.active = null;
      $("messages").dataset.signature = "";
      $("messages").replaceChildren(
        node(
          "p",
          "Conversation deleted. Create or select another conversation.",
          "empty-small",
        ),
      );
      $("session-title").textContent = "Your conversation space";
      $("tasks").replaceChildren();
      $("approvals").replaceChildren();
    }
    state.sessions = state.sessions.filter((s) => s.id !== id);
    state.details.delete(id);
    renderSessions();
  }
  $("action-dialog").close();
  $("session-menu").open = false;
});
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => $(b.dataset.close).close();
const voiceForm = $("settings-form");
let voiceCatalog = [],
  catalogRequest = null,
  catalogEpoch = 0;
function updatePreviewControls() {
  $("voice-preview").disabled =
    Boolean(state.preview) ||
    voiceForm.elements.voice_provider.value === "none";
  $("voice-preview-stop").disabled = !state.preview;
}
function renderVoicePicker() {
  const query = $("voice-search").value.trim().toLocaleLowerCase();
  const picker = $("voice-picker");
  picker.replaceChildren(new Option("Provider default / manual ID", ""));
  for (const voice of voiceCatalog) {
    if (`${voice.name} ${voice.id}`.toLocaleLowerCase().includes(query))
      picker.add(new Option(voice.name || voice.id, voice.id));
  }
  picker.value = voiceForm.elements.voice.value;
  if (picker.selectedIndex < 0) picker.value = "";
}
function cancelVoicePreview() {
  if (state.preview) {
    stopPlayback();
    voiceStatus("Ready", "Preview stopped. Microphone remains off.");
  }
}
async function loadVoiceCatalog() {
  catalogRequest?.abort();
  const request = new AbortController(),
    token = ++catalogEpoch;
  catalogRequest = request;
  const provider = voiceForm.elements.voice_provider.value;
  voiceCatalog = [];
  $("voice-search").value = "";
  $("voice-search").disabled = provider === "none";
  $("voice-picker").disabled = provider === "none";
  voiceForm.elements.voice.readOnly = provider === "none";
  renderVoicePicker();
  updatePreviewControls();
  $("voice-readiness").textContent =
    provider === "none"
      ? "Speech is off. Replies stay text-only."
      : "Loading provider voices…";
  if (provider === "none") return;
  const current = () =>
    token === catalogEpoch &&
    $("settings-dialog").open &&
    provider === voiceForm.elements.voice_provider.value;
  try {
    const result = await api(
      `/api/voices?provider=${encodeURIComponent(provider)}`,
      { signal: request.signal },
    );
    if (!current()) return;
    voiceCatalog = (result.voices || []).filter(
      (v) => typeof v.id === "string",
    );
    renderVoicePicker();
    $("voice-readiness").textContent =
      `${result.available ? "Ready. " : "Setup needed. "}${result.message || ""} ${voiceCatalog.length ? "Choose a voice or enter a manual ID." : "No voices listed; a manual voice ID is still supported."}`;
  } catch (error) {
    if (current() && error.name !== "AbortError")
      $("voice-readiness").textContent =
        `Voice list unavailable: ${error.message}. Enter a manual voice ID or use the provider default; check server-side setup.`;
  }
}
voiceForm.elements.voice_provider.onchange = () => {
  cancelVoicePreview();
  voiceForm.elements.voice.value = "";
  $("voice-preview-status").textContent = "";
  loadVoiceCatalog();
};
$("voice-search").oninput = renderVoicePicker;
$("voice-picker").onchange = () => {
  cancelVoicePreview();
  voiceForm.elements.voice.value = $("voice-picker").value;
};
voiceForm.elements.voice.oninput = () => {
  cancelVoicePreview();
  renderVoicePicker();
};
$("voice-preview-stop").onclick = cancelVoicePreview;
$("voice-preview").onclick = async () => {
  if (state.preview || voiceForm.elements.voice_provider.value === "none")
    return;
  stopPlayback();
  stopMic(); // Never capture the fixed sample, including pending mic startup/transcription.
  state.speechQueue = [];
  state.pendingSpeech.clear();
  const request = new AbortController(),
    token = state.audioEpoch,
    epoch = state.epoch;
  state.preview = request;
  updatePreviewControls();
  $("voice-preview-status").textContent = "Preparing preview…";
  const current = () =>
    state.preview === request &&
    token === state.audioEpoch &&
    epoch === state.epoch &&
    $("settings-dialog").open;
  let playing = false;
  try {
    const audio = await api("/api/voice-preview", {
      method: "POST",
      body: {
        provider: voiceForm.elements.voice_provider.value,
        voice: voiceForm.elements.voice.value.trim(),
      },
      signal: request.signal,
      blob: true,
    });
    if (!current()) return;
    state.audioURL = URL.createObjectURL(audio);
    const player = new Audio(state.audioURL);
    state.audio = player;
    orb.attach(player);
    player.onended = () => {
      if (!current()) return;
      stopPlayback();
      $("voice-preview-status").textContent =
        "Preview finished. Changes are not saved.";
      voiceStatus("Ready", "Preview finished. Microphone remains off.");
    };
    playing = true;
    await player.play();
    if (!current()) return;
    $("voice-preview-status").textContent =
      "Playing preview. Changes are not saved.";
    voiceStatus("Speaking…", "Voice preview · microphone off");
  } catch (error) {
    if (!current()) return;
    stopPlayback();
    $("voice-preview-status").textContent = playing
      ? "Preview playback was blocked or unavailable. Try again."
      : `Preview unavailable: ${error.message}`;
    voiceStatus("Ready", "Preview unavailable. Text chat is unaffected.");
  }
};
$("settings-dialog").addEventListener("close", () => {
  cancelVoicePreview();
  catalogEpoch++;
  catalogRequest?.abort();
});
$("settings-dialog").addEventListener("cancel", cancelVoicePreview);
$("settings-open").onclick = safeRun(async () => {
  if ($("stream-replies").checked || state.stream) stopLocal();
  state.settings = await api("/api/settings");
  for (const key of [
    "provider",
    "model",
    "fast_model",
    "voice_provider",
    "voice",
    "language",
  ])
    $("settings-form").elements[key].value = state.settings[key] || "";
  $("settings-status").textContent = "";
  $("settings-dialog").showModal();
  $("voice-preview-status").textContent = "";
  loadVoiceCatalog();
});
$("settings-form").onsubmit = safeRun(async (event) => {
  event.preventDefault();
  cancelVoicePreview();
  const values = Object.fromEntries(new FormData($("settings-form")));
  $("settings-status").textContent = "Saving…";
  await api("/api/settings", { method: "PATCH", body: values });
  state.settings = await api("/api/settings");
  if (state.settings.voice_provider === "none") stopPlayback();
  $("settings-status").textContent = "Saved and verified.";
});
$("interrupt").onclick = safeRun(async () => {
  stopLocal();
  voiceStatus(
    "Interrupted",
    "Foreground chat and local audio stopped. Workers are not cancelled.",
  );
  // Update local status before awaiting transport; a late stop response must not
  // overwrite a newer Read aloud or the status of a different session.
  if (state.active)
    await api(`/api/sessions/${encodeURIComponent(state.active)}/stop`, {
      method: "POST",
    });
});
async function startMic() {
  await orb.prepare();
  if (!state.active)
    throw new Error(
      "Create or select a conversation before starting the microphone.",
    );
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
    throw new Error(
      "Microphone capture needs a supported browser on localhost or HTTPS. Text chat remains available.",
    );
  stopPlayback();
  const epoch = state.epoch,
    token = ++state.micEpoch,
    id = state.active;
  $("microphone").textContent = "End mic";
  voiceStatus(
    "Requesting microphone…",
    "Allow microphone access in your browser to speak.",
  );
  let stream, context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (token !== state.micEpoch || epoch !== state.epoch) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    context = new AudioContext();
    await context.audioWorklet.addModule("/static/capture-worklet.js");
    await context.resume();
    if (token !== state.micEpoch || epoch !== state.epoch) {
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
      return;
    }
    const source = context.createMediaStreamSource(stream),
      worklet = new AudioWorkletNode(context, "hermes-capture"),
      gain = context.createGain(),
      gate = new SpeechGate({ sampleRate: context.sampleRate });
    gain.gain.value = 0;
    source.connect(worklet);
    worklet.connect(gain);
    gain.connect(context.destination);
    state.mic = { stream, context, source, worklet, gain, gate };
    document.body.classList.add("listening");
    voiceStatus(
      "Listening…",
      "Pause briefly to transcribe. End mic stops capture immediately.",
    );
    worklet.port.onmessage = async (event) => {
      orb.input(event.data);
      if (
        token !== state.micEpoch ||
        epoch !== state.epoch ||
        state.transcribing ||
        state.audio ||
        state.speechPreparing ||
        chatBusy()
      ) {
        gate.reset();
        return;
      }
      const samples = gate.push(event.data);
      if (!samples) return;
      state.transcribing = true;
      voiceStatus("Transcribing…", "Audio is sent to your local service.");
      try {
        const form = new FormData();
        form.append(
          "audio",
          new Blob([encodeWav(samples, context.sampleRate)], {
            type: "audio/wav",
          }),
          "speech.wav",
        );
        const result = await api("/api/transcribe", {
          method: "POST",
          body: form,
        });
        if (
          token !== state.micEpoch ||
          epoch !== state.epoch ||
          id !== state.active
        )
          return;
        if (result.text?.trim()) {
          if (
            $("hands-free").checked &&
            !$("worker-mode").checked &&
            !$("message-input").value.trim()
          ) {
            await sendText(result.text.trim(), false);
          } else {
            $("message-input").value = [
              $("message-input").value.trim(),
              result.text.trim(),
            ]
              .filter(Boolean)
              .join(" ");
            voiceStatus(
              "Transcript ready",
              "Review the text, then Send. Tool-enabled speech always requires explicit Send.",
            );
          }
        }
      } catch (error) {
        if (token === state.micEpoch)
          notify(
            `Transcription unavailable: ${error.message}. Type your message instead.`,
          );
      } finally {
        if (token === state.micEpoch) {
          state.transcribing = false;
          gate.reset();
        }
      }
    };
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    context?.close().catch(() => {});
    if (token === state.micEpoch) stopMic();
    throw new Error(
      `Microphone unavailable: ${error.message}. You can still use text chat.`,
    );
  }
}
$("microphone").onclick = safeRun(async () => {
  if (state.mic || $("microphone").textContent === "End mic") stopMic();
  else await startMic();
});
window.addEventListener("pagehide", () => {
  stopLocal();
  orb.destroy();
});
try {
  state.settings = await api("/api/settings");
  if (!state.settings.hermes_available)
    notify(
      "The service is running, but Hermes is not available. Check the server’s Hermes installation and provider setup. Your history is still accessible.",
    );
} catch (error) {
  notify(
    `Cannot load settings: ${error.message}. Retrying the service connection.`,
  );
}
setupWizard = createSetupWizard({
  api,
  stopLocal,
  onSaved: (settings) => {
    state.settings = settings;
  },
});
poll();
setupWizard.init();
