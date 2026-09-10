// Lossless provider-size chunks for completed replies and sentence-ready streams.
export function splitSpeechText(text, target = 260) {
  if (!Number.isInteger(target) || target < 2 || target > 4000)
    throw new RangeError("Speech chunk target must be between 2 and 4000.");
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const minimum = Math.floor(target * 0.65);
      const punctuation = [
        ...window.matchAll(/[.!?。！？][\s"'”’)]*|[;:\n]\s*/gu),
      ]
        .map((m) => m.index + m[0].length)
        .filter((n) => n >= minimum);
      // Prefer even an earlier word boundary to bisecting an ordinary word.
      const words = [...window.matchAll(/\s+/gu)].map(
        (m) => m.index + m[0].length,
      );
      end = start + (punctuation.at(-1) || words.at(-1) || target);
      // Never bisect a surrogate pair, even in a long unbroken token.
      if (
        /[\uD800-\uDBFF]/.test(text[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(text[end])
      )
        end--;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

const mediaError = () =>
  new Error(
    "Audio playback was blocked or unavailable. Use Read aloud to retry; the full reply remains visible.",
  );

// One owner, one current Audio, one next synthesis. All async continuations check
// identity; stop settles immediately even if a transport ignores AbortSignal.
export class SpeechPlayback {
  constructor({
    synthesize,
    createAudio = (url) => new Audio(url),
    createURL = (blob) => URL.createObjectURL(blob),
    revokeURL = (url) => URL.revokeObjectURL(url),
    onState = () => {},
    onError = () => {},
  }) {
    Object.assign(this, {
      synthesize,
      createAudio,
      createURL,
      revokeURL,
      onState,
      onError,
    });
    this.owner = null;
  }
  get active() {
    return this.owner !== null;
  }
  stop() {
    if (this.owner) this.finish(this.owner, "stopped");
  }
  release(owner) {
    if (owner.audio) {
      owner.audio.onended = owner.audio.onerror = null;
      owner.audio.pause();
      owner.audio.src = "";
      owner.audio = null;
    }
    if (owner.url !== null) this.revokeURL(owner.url);
    owner.url = null;
    owner.releaseWait?.();
    owner.releaseWait = null;
  }
  finish(owner, reason, error) {
    if (this.owner !== owner) return;
    this.owner = null;
    owner.abort.abort();
    owner.wake?.();
    this.release(owner);
    this.onState({ phase: "idle", reason, audio: null });
    if (error) this.onError(error);
    owner.resolve(reason);
  }
  start(text, options = {}) {
    this.stop();
    // Whitespace has no spoken content; do not send empty spans to a provider.
    const chunks = splitSpeechText(text).filter((chunk) => chunk.trim());
    if (!text.trim()) return Promise.resolve("completed");
    return this.begin(chunks, options, true).done;
  }
  // The returned handle is an epoch: stale producers cannot rearm a new owner.
  startStream(options = {}) {
    this.stop();
    return this.begin([], options, false);
  }
  begin(chunks, options, finalized) {
    let resolve;
    const done = new Promise((r) => {
      resolve = r;
    });
    const owner = {
      abort: new AbortController(),
      resolve,
      audio: null,
      url: null,
      finalized,
      accepted: "",
      cumulative: "",
      wake: null,
    };
    this.owner = owner;
    this.onState({ phase: "preparing", audio: null });
    const current = () => this.owner === owner;
    const synthesize = (chunk) => {
      // Attach rejection handling immediately, including to the prefetched promise.
      try {
        return Promise.resolve(
          this.synthesize(chunk, { ...options, signal: owner.abort.signal }),
        ).catch((error) => {
          this.finish(owner, "failed", error);
          return null;
        });
      } catch (error) {
        this.finish(owner, "failed", error);
        return Promise.resolve(null);
      }
    };
    // A waiting lookahead holds no audio resource. At most one synthesis is
    // outstanding beyond the playing chunk, even if many sentences arrive.
    const take = () => {
      if (!current()) return Promise.resolve(null);
      if (chunks.length) return synthesize(chunks.shift());
      if (owner.finalized) return Promise.resolve(null);
      return new Promise((r) => {
        owner.wake = r;
      }).then(() => {
        owner.wake = null;
        return take();
      });
    };
    const run = async () => {
      let next = take();
      while (current()) {
        const blob = await next;
        if (!current()) return;
        if (blob === null) break;
        owner.url = this.createURL(blob);
        const player = this.createAudio(owner.url);
        owner.audio = player;
        const ended = new Promise((r) => {
          owner.releaseWait = r;
        });
        player.onended = () => {
          if (current() && owner.audio === player) owner.releaseWait?.();
        };
        player.onerror = () => {
          if (current() && owner.audio === player)
            this.finish(owner, "failed", mediaError());
        };
        this.onState({ phase: "preparing", audio: player });
        try {
          await player.play();
        } catch {
          throw mediaError();
        }
        if (!current()) return;
        this.onState({ phase: "playing", audio: player });
        // Prefetch only after this chunk starts. Never build an unbounded queue.
        next = take();
        await ended;
        if (!current()) return;
        this.release(owner);
        if (chunks.length || !owner.finalized || next)
          this.onState({ phase: "preparing", audio: null });
      }
      this.finish(owner, "completed");
    };
    run().catch((error) => this.finish(owner, "failed", error));
    const accept = (text, final) => {
      if (!current() || owner.finalized) return false;
      if (typeof text !== "string") return false;
      const prefix = final ? owner.accepted : owner.cumulative;
      if (!text.startsWith(prefix)) {
        this.finish(
          owner,
          "failed",
          new Error(
            "Reply text changed during streaming. Automatic speech stopped; read the final reply or use Read aloud.",
          ),
        );
        return false;
      }
      owner.cumulative = text;
      let end = final ? text.length : owner.accepted.length;
      if (!final) {
        const remaining = text.slice(end);
        // Complete sentence or paragraph only; punctuation may end a snapshot.
        for (const m of remaining.matchAll(
          /[.!?。！？]["'”’)]*(?:\s+|$)|\n\s*\n/gu,
        ))
          end = owner.accepted.length + m.index + m[0].length;
      }
      chunks.push(
        ...splitSpeechText(text.slice(owner.accepted.length, end)).filter(
          (chunk) => chunk.trim(),
        ),
      );
      owner.accepted = text.slice(0, end);
      owner.finalized = final;
      owner.wake?.();
      return true;
    };
    return {
      done,
      append: (text) => accept(text, false),
      final: (text) => accept(text, true),
    };
  }
}
