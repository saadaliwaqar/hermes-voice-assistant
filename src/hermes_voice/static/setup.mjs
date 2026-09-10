// First-run setup owns its draft and media; it never starts inference or capture on load.
export function createSetupWizard({ api, stopLocal, onSaved }) {
  const $ = (id) => document.getElementById(id);
  const dialog = document.createElement("dialog");
  dialog.id = "setup-dialog";
  dialog.setAttribute("aria-labelledby", "setup-title");
  dialog.innerHTML = `
    <div class="setup-content">
      <div class="dialog-head"><div><p id="setup-progress" class="eyebrow"></p><h2 id="setup-title" tabindex="-1">Welcome to Hermes</h2></div><button id="setup-skip" type="button">Skip for now</button></div>
      <p class="muted">Optional setup, at your pace. No API keys belong in this browser. Configure credentials on the server. Nothing listens or calls a model automatically.</p>
      <section data-setup-step="0">
        <p>Review these system checks before choosing your defaults. A ready configuration check is not a tested model connection.</p>
        <ul id="setup-checks" class="setup-checks"></ul>
        <p id="setup-check-note" role="status"></p>
        <p>You can explore the text-only dashboard and history without voice. This does not mean chat is ready: chat and workers require a working Hermes runtime and configured model provider.</p>
        <button id="setup-refresh" type="button">Refresh checks</button>
      </section>
      <section data-setup-step="1" hidden>
        <p>The default model runs workers and chat. The optional conversation model overrides only tool-free chat. Use model IDs supported by your server-side provider.</p>
        <div class="fields">
          <label>Model provider<input id="setup-provider" maxlength="100" autocomplete="off"></label>
          <label>Default model<input id="setup-model" maxlength="200" autocomplete="off"></label>
          <label>Conversation model (optional)<input id="setup-fast-model" maxlength="200" autocomplete="off"></label>
        </div>
        <p id="setup-billing">Test connection sends one small, tool-free request to the selected default model and may incur a small charge. It does not test the conversation override or run workers. This is optional; credentials stay on the server.</p>
        <button id="setup-test-model" type="button" aria-describedby="setup-billing">Test connection</button>
        <p id="setup-model-result" role="status">Not tested. You can continue without a paid check.</p>
      </section>
      <section data-setup-step="2" hidden>
        <p>Choose None for text-only replies, Edge for online speech, OpenAI or ElevenLabs with server credentials, or Piper with a locally installed voice. Provider previews may use a paid speech service.</p>
        <div class="fields">
          <label>Setup speech provider<select id="setup-voice-provider"><option value="none">None — text only</option><option value="edge">Edge</option><option value="openai">OpenAI</option><option value="elevenlabs">ElevenLabs</option><option value="piper">Piper — offline</option></select></label>
          <label>Setup available voices<select id="setup-voice-picker"><option value="">Provider default / manual ID</option></select></label>
          <label>Setup voice name / manual ID<input id="setup-voice" maxlength="200"></label>
          <label>Setup language<input id="setup-language" maxlength="30" placeholder="en"></label>
        </div>
        <p id="setup-voice-readiness" role="status"></p>
        <p class="muted">You can refine and search voices later in Settings. Choices here stay in this draft until you explicitly save.</p>
      </section>
      <section data-setup-step="3" hidden>
        <p>Test microphone checks local input levels only: no recording is uploaded, transcribed, saved, or sent to chat. Allow access only when you choose to test. Leaving this step releases capture.</p>
        <div class="voice-preview-actions"><button id="setup-mic" type="button">Test microphone</button><button id="setup-speaker" type="button">Test speaker</button><button id="setup-stop" type="button">Stop test</button></div>
        <label>Microphone level <meter id="setup-level" min="0" max="1" value="0"></meter></label>
        <p id="setup-audio-result" role="status">Not tested. Audio tests are optional.</p>
        <p class="muted">Speaker test plays a fixed sample using your selected speech provider and voice; it may incur provider charges. It stops microphone capture and never restarts it.</p>
      </section>
      <section data-setup-step="4" hidden>
        <p>Review your choices. Save writes only these defaults, then reads them back. Finish records that you completed the tour; it does not certify every system check or test.</p>
        <dl id="setup-summary"></dl>
        <p id="setup-review-tests"></p>
        <button id="setup-save" type="button">Save choices</button><p id="setup-save-result" role="status"></p>
        <h3>Your dashboard tour</h3>
        <p>Workspace switches conversations; each keeps its own history and workers. The composer sends text once the runtime and provider work. “Send to worker” explicitly enables tools; review permissions in the Approvals inbox. Interrupt stops foreground chat and audio, not workers. Cancel workers on their own cards.</p>
        <p>Start mic is always explicit. Use Settings for voice and model changes, and Setup to return here. Missing dependencies still need server-side setup even after finishing this tour.</p>
      </section>
      <p id="setup-error" role="alert"></p>
      <div class="dialog-actions"><button id="setup-back" type="button">Back</button><button id="setup-next" type="button" class="primary">Next</button><button id="setup-finish" type="button" class="primary" hidden>Finish setup</button></div>
    </div>`;
  document.body.append(dialog);
  const fields = {
    provider: "provider",
    model: "model",
    fast_model: "fast-model",
    voice_provider: "voice-provider",
    voice: "voice",
    language: "language",
  };
  const titles = [
    "Welcome to Hermes",
    "Choose your models",
    "Choose your voice",
    "Test microphone and speaker",
    "Review and finish",
  ];
  let step = 0,
    epoch = 0,
    mediaEpoch = 0,
    catalogEpoch = 0,
    modelEpoch = 0;
  let status = null,
    draft = {},
    saved = {},
    modelResult = "Not tested",
    micResult = "Not tested",
    speakerResult = "Not tested";
  let stream,
    context,
    source,
    frame,
    player,
    audioURL,
    previewRequest,
    modelRequest,
    catalogRequest;
  let busy = false,
    opening = false;
  const readDraft = () =>
    Object.fromEntries(
      Object.entries(fields).map(([key, id]) => [
        key,
        $("setup-" + id).value.trim(),
      ]),
    );
  const changed = () => Object.keys(fields).some((k) => draft[k] !== saved[k]);
  function stopMedia() {
    mediaEpoch++;
    previewRequest?.abort();
    previewRequest = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    cancelAnimationFrame(frame);
    source?.disconnect();
    source = null;
    context?.close().catch(() => {});
    context = null;
    if (player) {
      player.onended = null;
      player.pause();
      player.src = "";
      player = null;
    }
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = null;
    $("setup-level").value = 0;
    $("setup-mic").disabled = false;
    $("setup-speaker").disabled = draft.voice_provider === "none";
    $("setup-stop").disabled = true;
    $("setup-audio-result").textContent = "Tests stopped. Microphone off.";
  }
  function invalidateModel() {
    modelEpoch++;
    modelRequest?.abort();
    modelRequest = null;
    modelResult = "Not tested";
    $("setup-model-result").textContent =
      "Not tested. You can continue without a paid check.";
    $("setup-test-model").disabled = false;
  }
  function close() {
    if (busy) return;
    epoch++;
    catalogEpoch++;
    catalogRequest?.abort();
    invalidateModel();
    stopMedia();
    dialog.close();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    epoch++;
    catalogEpoch++;
    catalogRequest?.abort();
    invalidateModel();
    stopMedia();
  });
  $("setup-skip").onclick = close;
  $("setup-stop").onclick = stopMedia;
  async function checks() {
    try {
      const result = await api("/api/setup");
      if (
        typeof result.completed !== "boolean" ||
        !Array.isArray(result.checks)
      )
        throw new Error("Unsupported setup response");
      return result;
    } catch {
      return null;
    }
  }
  function renderChecks() {
    $("setup-checks").replaceChildren();
    for (const check of status?.checks || []) {
      const item = document.createElement("li");
      const flag = ["ready", "missing", "warning"].includes(check.status)
        ? check.status
        : "warning";
      item.dataset.status = flag;
      const label = document.createElement("strong");
      label.textContent = `${check.label}: ${flag}`;
      const detail = document.createElement("p");
      detail.textContent = check.detail || "No details supplied.";
      item.append(label, detail);
      $("setup-checks").append(item);
    }
    $("setup-check-note").textContent = !status
      ? "Setup status unavailable. The dashboard remains accessible. Update or check the local service; completion cannot be recorded until setup is available."
      : status.checks.some((c) => c.status !== "ready")
        ? "Some checks need attention. You can still continue the tour; missing services are not enabled by finishing."
        : "Configuration checks returned ready. Model and audio tests remain separate, optional checks.";
  }
  async function open(data) {
    if (opening || dialog.open) return;
    opening = true;
    stopLocal();
    try {
      const [result, settings] = await Promise.all([
        data === undefined ? checks() : data,
        api("/api/settings"),
      ]);
      status = result;
      saved = Object.fromEntries(
        Object.keys(fields).map((k) => [
          k,
          String(settings[k] ?? status?.defaults?.[k] ?? ""),
        ]),
      );
      draft = { ...saved };
      if (!draft.voice_provider)
        draft.voice_provider = saved.voice_provider = "none";
      for (const [key, id] of Object.entries(fields))
        $("setup-" + id).value = draft[key];
      epoch++;
      step = 0;
      invalidateModel();
      micResult = speakerResult = "Not tested";
      $("setup-save-result").textContent = "";
      $("setup-error").textContent = "";
      renderChecks();
      dialog.showModal();
      render();
    } catch (error) {
      $("notice-text").textContent = `Setup unavailable: ${error.message}`;
      $("notice").hidden = false;
    } finally {
      opening = false;
    }
  }
  $("setup-open").onclick = () => open();
  $("setup-refresh").onclick = async () => {
    const token = epoch;
    $("setup-refresh").disabled = true;
    const result = await checks();
    if (token === epoch && dialog.open) {
      status = result;
      renderChecks();
    }
    $("setup-refresh").disabled = false;
  };
  function render() {
    stopMedia();
    $("setup-title").textContent = titles[step];
    $("setup-progress").textContent =
      `FIRST-RUN GUIDE · STEP ${step + 1} OF ${titles.length}`;
    dialog.querySelectorAll("[data-setup-step]").forEach((el) => {
      el.hidden = Number(el.dataset.setupStep) !== step;
    });
    $("setup-back").disabled = step === 0;
    $("setup-next").hidden = step === 4;
    $("setup-finish").hidden = step !== 4;
    $("setup-finish").disabled = !status || changed();
    $("setup-error").textContent = "";
    if (step === 2) loadCatalog();
    if (step === 4) {
      $("setup-summary").replaceChildren();
      for (const [key, value] of Object.entries(draft)) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = key.replaceAll("_", " ");
        dd.textContent = value || "Server default";
        $("setup-summary").append(dt, dd);
      }
      $("setup-review-tests").textContent =
        `Default model: ${modelResult}. Microphone: ${micResult}. Speaker: ${speakerResult}.`;
      if (changed())
        $("setup-save-result").textContent =
          "Unsaved choices. Save before finishing, or Skip for now to discard them.";
    }
    $("setup-title").focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }
  $("setup-next").onclick = () => {
    if (!busy && step < 4) {
      step++;
      render();
    }
  };
  $("setup-back").onclick = () => {
    if (!busy && step > 0) {
      step--;
      render();
    }
  };
  for (const [key, id] of Object.entries(fields)) {
    $("setup-" + id).addEventListener("input", () => {
      draft = readDraft();
      $("setup-save-result").textContent = "";
      if (["provider", "model", "fast_model"].includes(key)) invalidateModel();
      if (["voice_provider", "voice"].includes(key)) {
        stopMedia();
        speakerResult = "Not tested";
      }
    });
  }
  $("setup-voice-provider").onchange = () => {
    $("setup-voice").value = "";
    draft = readDraft();
    stopMedia();
    loadCatalog();
  };
  $("setup-voice-picker").onchange = () => {
    $("setup-voice").value = $("setup-voice-picker").value;
    draft = readDraft();
    speakerResult = "Not tested";
    stopMedia();
  };
  async function loadCatalog() {
    catalogRequest?.abort();
    const request = new AbortController();
    catalogRequest = request;
    const token = ++catalogEpoch,
      owner = epoch,
      provider = draft.voice_provider;
    const picker = $("setup-voice-picker");
    picker.replaceChildren(new Option("Provider default / manual ID", ""));
    picker.disabled = provider === "none";
    $("setup-voice").readOnly = provider === "none";
    $("setup-voice-readiness").textContent =
      provider === "none"
        ? "Speech is off. No speaker test is needed."
        : "Loading voices…";
    if (provider === "none") return;
    const current = () =>
      dialog.open &&
      owner === epoch &&
      token === catalogEpoch &&
      provider === draft.voice_provider;
    try {
      const result = await api(
        `/api/voices?provider=${encodeURIComponent(provider)}`,
        { signal: request.signal },
      );
      if (!current()) return;
      for (const voice of result.voices || [])
        if (typeof voice.id === "string")
          picker.add(new Option(voice.name || voice.id, voice.id));
      picker.value = draft.voice;
      if (picker.selectedIndex < 0) picker.value = "";
      $("setup-voice-readiness").textContent =
        `${result.available ? "Configured" : "Setup needed"}. ${result.message || "Check provider configuration on the server."} Manual voice IDs are supported.`;
    } catch (error) {
      if (current())
        $("setup-voice-readiness").textContent =
          `Voice catalog unavailable: ${error.message}. You may enter a manual ID; this does not verify the provider.`;
    }
  }
  $("setup-test-model").onclick = async () => {
    invalidateModel();
    const token = modelEpoch,
      owner = epoch;
    const request = new AbortController();
    modelRequest = request;
    $("setup-test-model").disabled = true;
    $("setup-model-result").textContent = "Testing selected default model…";
    const current = () =>
      dialog.open && owner === epoch && token === modelEpoch;
    try {
      const result = await api("/api/setup/test-model", {
        method: "POST",
        body: { model: draft.model, provider: draft.provider },
        signal: request.signal,
      });
      if (!current()) return;
      modelResult = result.ok === true ? "Passed" : "Failed";
      $("setup-model-result").textContent =
        `${modelResult}: ${result.message || "No details returned"}`;
    } catch (error) {
      if (current()) {
        modelResult = "Failed";
        $("setup-model-result").textContent = `Check failed: ${error.message}`;
      }
    } finally {
      if (current()) $("setup-test-model").disabled = false;
    }
  };
  $("setup-mic").onclick = async () => {
    stopLocal();
    stopMedia();
    const token = mediaEpoch,
      owner = epoch;
    const current = () =>
      dialog.open && step === 3 && token === mediaEpoch && owner === epoch;
    $("setup-mic").disabled = true;
    $("setup-stop").disabled = false;
    $("setup-audio-result").textContent = "Requesting microphone permission…";
    let acquired, audioContext;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Use localhost or HTTPS with a supported browser");
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (!current()) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = acquired;
      audioContext = new AudioContext();
      context = audioContext;
      await audioContext.resume();
      if (!current()) {
        acquired.getTracks().forEach((t) => t.stop());
        if (audioContext.state !== "closed") await audioContext.close();
        return;
      }
      source = audioContext.createMediaStreamSource(acquired);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!current()) return;
        analyser.getFloatTimeDomainData(samples);
        $("setup-level").value = Math.min(
          1,
          Math.sqrt(
            samples.reduce((sum, v) => sum + v * v, 0) / samples.length,
          ) * 5,
        );
        frame = requestAnimationFrame(tick);
      };
      tick();
      micResult = "Capture opened (check the level meter)";
      $("setup-audio-result").textContent =
        "Microphone active — speak and watch the level meter. Local only; nothing is uploaded.";
    } catch (error) {
      acquired?.getTracks().forEach((t) => t.stop());
      if (audioContext && audioContext.state !== "closed")
        audioContext.close().catch(() => {});
      if (current()) {
        stopMedia();
        micResult = "Unavailable";
        $("setup-audio-result").textContent =
          `Microphone unavailable: ${error.message}`;
      }
    }
  };
  $("setup-speaker").onclick = async () => {
    if (draft.voice_provider === "none") return;
    stopLocal();
    stopMedia();
    const token = mediaEpoch,
      owner = epoch,
      request = new AbortController();
    previewRequest = request;
    const current = () =>
      dialog.open && step === 3 && token === mediaEpoch && owner === epoch;
    $("setup-speaker").disabled = true;
    $("setup-stop").disabled = false;
    $("setup-audio-result").textContent = "Preparing selected voice preview…";
    try {
      const audio = await api("/api/voice-preview", {
        method: "POST",
        body: { provider: draft.voice_provider, voice: draft.voice },
        signal: request.signal,
        blob: true,
      });
      if (!current()) return;
      audioURL = URL.createObjectURL(audio);
      const audioPlayer = new Audio(audioURL);
      player = audioPlayer;
      audioPlayer.onended = () => {
        if (current()) {
          stopMedia();
          speakerResult = "Sample played (confirm you heard it)";
          $("setup-audio-result").textContent =
            "Speaker sample finished. Did you hear your selected voice? Microphone remains off.";
        }
      };
      await audioPlayer.play();
      if (current()) {
        speakerResult = "Playback started (confirm you heard it)";
        $("setup-audio-result").textContent =
          "Playing selected voice sample. Microphone off.";
      }
    } catch (error) {
      if (current()) {
        stopMedia();
        speakerResult = "Unavailable";
        $("setup-audio-result").textContent =
          `Speaker preview unavailable: ${error.message}`;
      }
    }
  };
  function setBusy(value) {
    busy = value;
    for (const id of [
      "setup-skip",
      "setup-back",
      "setup-next",
      "setup-save",
      "setup-finish",
    ])
      $(id).disabled = value;
    if (!value) {
      $("setup-back").disabled = step === 0;
      $("setup-finish").disabled = !status || changed();
    }
  }
  $("setup-save").onclick = async () => {
    if (busy) return;
    setBusy(true);
    $("setup-save-result").textContent = "Saving…";
    const values = { ...draft };
    try {
      await api("/api/settings", { method: "PATCH", body: values });
      const result = await api("/api/settings");
      onSaved(result);
      if (
        Object.keys(fields).some((k) => String(result[k] ?? "") !== values[k])
      )
        throw new Error(
          "Server read-back differs from these choices. Review Settings before finishing.",
        );
      saved = { ...values };
      $("setup-save-result").textContent = "Saved and verified.";
    } catch (error) {
      $("setup-save-result").textContent =
        `Could not verify save: ${error.message}. A submitted save may already have reached the server.`;
    } finally {
      setBusy(false);
    }
  };
  $("setup-finish").onclick = async () => {
    if (busy || !status || changed()) return;
    setBusy(true);
    try {
      const result = await api("/api/setup/complete", {
        method: "POST",
        body: {},
      });
      const verified = await checks();
      if (result.completed !== true || verified?.completed !== true)
        throw new Error("Completion was not verified. Try again.");
      status = verified;
      setBusy(false);
      close();
    } catch (error) {
      $("setup-error").textContent = error.message;
    } finally {
      setBusy(false);
    }
  };
  return {
    stopMedia,
    async init() {
      const result = await checks();
      if (result?.completed === false) await open(result);
    },
  };
}
