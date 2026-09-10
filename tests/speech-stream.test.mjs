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
test("early sentence, busy gap, final suffix exactly once", async () => {
  const h = harness(),
    s = h.playback.startStream();
  s.append("First");
  assert.equal(h.requests.length, 0);
  s.append("First sentence. Pending");
  await tick();
  assert.equal(h.requests[0].text, "First sentence. ");
  h.requests[0].resolve(0);
  await tick();
  h.players[0].end();
  await tick();
  assert.equal(h.playback.active, true);
  s.final("First sentence. Pending suffix");
  await tick();
  assert.equal(h.requests[1].text, "Pending suffix");
  h.requests[1].resolve(1);
  await tick();
  h.players[1].end();
  assert.equal(await s.done, "completed");
  assert.equal(
    h.requests.map((x) => x.text).join(""),
    "First sentence. Pending suffix",
  );
});
test("final only, stale handles, rewrites and provider failure never restart", async () => {
  const h = harness(),
    old = h.playback.startStream();
  old.append("Old sentence. ");
  await tick();
  h.playback.stop();
  assert.equal(await old.done, "stopped");
  const fresh = h.playback.startStream();
  old.final("Old sentence. late");
  fresh.final("Only final");
  await tick();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(0);
  h.requests[1].resolve(1);
  await tick();
  assert.equal(h.players.length, 1);
  h.players[0].end();
  await fresh.done;
  const rewrite = h.playback.startStream();
  rewrite.append("Accepted. ");
  await tick();
  rewrite.final("Changed result");
  assert.equal(await rewrite.done, "failed");
  assert.match(h.errors[0], /changed/i);
  assert.equal(h.playback.active, false);
  const failure = h.playback.startStream();
  failure.append("Failure. ");
  await tick();
  h.requests.at(-1).reject(new Error("provider down"));
  await tick();
  failure.final("Failure. extra");
  assert.equal(await failure.done, "failed");
  assert.equal(h.requests.length, 4);
});

test("stream has one lookahead and stop discards queued/waiting work synchronously", async () => {
 const h=harness(), s=h.playback.startStream();
 s.append("One sentence. ");await tick();h.requests[0].resolve(0);await tick();
 s.append("One sentence. Two sentences. ");await tick();assert.equal(h.requests.length,2);
 s.append("One sentence. Two sentences. "+"More complete sentences. ".repeat(100));
 await tick();h.requests[1].resolve(1);await tick();assert.equal(h.requests.length,2);
 h.playback.stop();assert.equal(h.playback.active,false);assert.equal(await s.done,"stopped");
 s.final("One sentence. Two sentences. Done");await tick();assert.equal(h.requests.length,2);
 const waiting=h.playback.startStream();waiting.append("Queued sentence. ");h.playback.stop();
 await tick();assert.equal(await waiting.done,"stopped");assert.equal(h.requests.length,2);
});
test("unpunctuated tokens wait for final; paragraphs and long final chunks remain bounded", async () => {
 const h=harness(),s=h.playback.startStream();const text="a".repeat(9000);
 for(let n=1;n<=text.length;n+=100)s.append(text.slice(0,n));
 await tick();assert.equal(h.requests.length,0);
 s.final(text);await tick();
 for(let i=0;h.playback.active;i++){
  assert.ok(h.requests[i].text.length<=4000);h.requests[i].resolve(i);await tick();h.players[i].end();await tick();
 }
 assert.equal(await s.done,"completed");assert.equal(h.requests.map(x=>x.text).join(""),text);
 const p=h.playback.startStream();p.append("A paragraph without punctuation\n\nNext unfinished");await tick();
 assert.equal(h.requests.at(-1).text,"A paragraph without punctuation\n\n");h.playback.stop();await p.done;
});
