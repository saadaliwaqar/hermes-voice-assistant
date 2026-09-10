import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSpeechText,
  SpeechPlayback,
} from "../src/hermes_voice/static/speech-playback.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness() {
  const requests = [],
    players = [],
    revoked = [],
    states = [],
    errors = [];
  const playback = new SpeechPlayback({
    synthesize(text, { signal }) {
      const d = deferred();
      requests.push({ ...d, text, signal });
      return d.promise;
    },
    createURL: (blob) => `url:${blob}`,
    revokeURL: (url) => revoked.push(url),
    createAudio(url) {
      const p = {
        url,
        paused: true,
        src: url,
        play() {
          this.paused = false;
          return Promise.resolve();
        },
        pause() {
          this.paused = true;
        },
        end() {
          this.onended?.();
        },
        fail() {
          this.onerror?.();
        },
      };
      players.push(p);
      return p;
    },
    onState: (event) => states.push(event),
    onError: (e) => errors.push(e.message),
  });
  return { playback, requests, players, revoked, states, errors };
}
test("lossless bounded punctuation/word chunks, pathological unicode and whitespace", () => {
  for (const text of [
    "",
    "Hello. Next sentence!  Last?\n",
    "Sentence with words. ".repeat(500),
    "a".repeat(9000),
    "😀".repeat(4500),
    " \n\t".repeat(4000),
  ]) {
    const chunks = splitSpeechText(text);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every((c) => c.length > 0 && c.length <= 4000));
    assert.ok(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c)));
  }
  const text = "One sentence. ".repeat(50);
  const chunks = splitSpeechText(text);
  assert.ok(chunks[0].length >= 200 && chunks[0].length <= 300);
  assert.match(chunks[0], /\. $/);
  assert.throws(() => splitSpeechText("a", 0), RangeError);
  const longWords = `${"a".repeat(150)} ${"b".repeat(150)}`;
  assert.deepEqual(splitSpeechText(longWords), [
    "a".repeat(150) + " ",
    "b".repeat(150),
  ]);
});
test("first audio before rest synthesized; exactly one lookahead; ordered once; busy between chunks", async () => {
  const h = harness(),
    text = "This is a useful sentence. ".repeat(50),
    chunks = splitSpeechText(text);
  const done = h.playback.start(text);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(0);
  await tick();
  assert.equal(h.players.length, 1);
  assert.equal(h.players[0].paused, false);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(1);
  await tick();
  assert.equal(h.requests.length, 2);
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(h.players[i].url, `url:${i}`);
    h.players[i].end();
    await tick();
    if (i + 1 < chunks.length) {
      assert.equal(h.playback.active, true);
      if (i + 2 < chunks.length) {
        h.requests[i + 2].resolve(i + 2);
        await tick();
      }
    }
  }
  assert.equal(await done, "completed");
  assert.deepEqual(
    h.requests.map((r) => r.text),
    chunks,
  );
  assert.equal(h.revoked.length, chunks.length);
  assert.deepEqual(
    h.states.filter((s) => s.phase === "idle").map((s) => s.reason),
    ["completed"],
  );
});
test("long whitespace gaps do not create empty provider requests or drop words", async () => {
  const h = harness();
  const done = h.playback.start(
    " ".repeat(600) + "Hello there." + "\n".repeat(600) + "Last words.",
  );
  for (let i = 0; i < 10 && h.playback.active; i++) {
    assert.ok(
      h.requests[i].text.trim(),
      "never synthesize a whitespace-only chunk",
    );
    h.requests[i].resolve(i);
    await tick();
    h.players[i].end();
    await tick();
  }
  assert.equal(await done, "completed");
  assert.equal(
    h.requests.map((r) => r.text.trim()).join(" "),
    "Hello there. Last words.",
  );
});

test("interrupt aborts inflight first synthesis; late result cannot play", async () => {
  const h = harness(),
    done = h.playback.start("old");
  h.playback.stop();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(await done, "stopped");
  h.requests[0].resolve("old");
  await tick();
  assert.equal(h.players.length, 0);
});
test("new request owns state despite stale response/rejection/finally", async () => {
  const h = harness(),
    old = h.playback.start("old"),
    latest = h.playback.start("new");
  assert.equal(await old, "stopped");
  h.requests[0].reject(new Error("stale"));
  await tick();
  assert.equal(h.playback.active, true);
  assert.deepEqual(h.errors, []);
  h.requests[1].resolve("new");
  await tick();
  assert.equal(h.players.length, 1);
  h.players[0].end();
  assert.equal(await latest, "completed");
});
test("stop during playback aborts lookahead and revokes audio, ignoring late media events", async () => {
  const h = harness(),
    done = h.playback.start("Sentence. ".repeat(100));
  h.requests[0].resolve("first");
  await tick();
  const stale = h.players[0].onended;
  h.playback.stop();
  assert.ok(h.requests.every((r) => r.signal.aborted));
  assert.equal(h.players[0].paused, true);
  assert.deepEqual(h.revoked, ["url:first"]);
  h.requests[1].resolve("late");
  stale();
  await tick();
  assert.equal(h.players.length, 1);
  assert.equal(await done, "stopped");
});
test("prefetch failure stops current media and later chunks; explicit retry works", async () => {
  const h = harness(),
    done = h.playback.start("Sentence. ".repeat(100));
  h.requests[0].resolve("first");
  await tick();
  h.requests[1].reject(new Error("provider down"));
  await tick();
  assert.equal(await done, "failed");
  assert.equal(h.players[0].paused, true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.errors.length, 1);
  const retry = h.playback.start("retry");
  h.requests[2].resolve("retry");
  await tick();
  h.players[1].end();
  assert.equal(await retry, "completed");
});
test("media error aborts pending synthesis and stops sequence", async () => {
  const h = harness(),
    done = h.playback.start("Sentence. ".repeat(100));
  h.requests[0].resolve("first");
  await tick();
  h.players[0].fail();
  assert.equal(await done, "failed");
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.errors.length, 1);
});
test("play rejection does not prefetch and leaves no owned resources", async () => {
  const h = harness();
  h.playback.createAudio = (url) => ({
    src: url,
    pause() {},
    play() {
      return Promise.reject(new Error("blocked"));
    },
  });
  const done = h.playback.start("Sentence. ".repeat(100));
  h.requests[0].resolve("first");
  assert.equal(await done, "failed");
  assert.equal(h.requests.length, 1);
  assert.equal(h.playback.active, false);
  assert.equal(h.revoked.length, 1);
});

test("late play rejection from old player cannot fail newer playback", async () => {
  const h = harness(),
    play = deferred();
  const create = h.playback.createAudio;
  h.playback.createAudio = (url) => {
    const p = create(url);
    if (h.players.length === 1) p.play = () => play.promise;
    return p;
  };
  const old = h.playback.start("old");
  h.requests[0].resolve("old");
  await tick();
  const next = h.playback.start("new");
  h.requests[1].resolve("new");
  await tick();
  play.reject(new Error("stale blocked"));
  await tick();
  assert.equal(await old, "stopped");
  assert.equal(h.playback.active, true);
  assert.deepEqual(h.errors, []);
  h.players[1].end();
  assert.equal(await next, "completed");
});

test("late ended/error from prior chunk cannot skip or fail current chunk", async () => {
  const h = harness(),
    done = h.playback.start("Sentence. ".repeat(100));
  h.requests[0].resolve("first");
  await tick();
  const staleEnded = h.players[0].onended,
    staleError = h.players[0].onerror;
  h.requests[1].resolve("second");
  h.players[0].end();
  await tick();
  h.requests[2].resolve("third");
  staleEnded();
  await tick();
  assert.equal(h.players.length, 2);
  staleError();
  assert.equal(h.playback.active, true);
  assert.deepEqual(h.errors, []);
  h.playback.stop();
  assert.equal(await done, "stopped");
});
