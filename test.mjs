// node --test test.mjs  (runs against dist/ after `npm run build`; mocked fetch, no network)
import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, Client, credits, GenerationFailedError, QuotaError, RejectedError, AigifmakerError } from "./dist/mod.js";

const ok = (data) => ({ code: 0, message: "ok", data });
const SUBMITTED = ok({ id: "t1", status: "pending", taskId: "up-1" });

function fake(calls, polls, submitReply = SUBMITTED) {
  polls = [...polls];
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const json = url.endsWith("/api/ai/generate") ? submitReply
      : url.endsWith("/api/ai/query") ? ok(polls.shift())
      : ok({ remainingCredits: 42, made: 3 });
    return new Response(JSON.stringify(json), { status: 200 });
  };
}
const client = (calls, polls = [], submitReply, apiKey = "sk-abc") =>
  new Client({ apiKey, baseUrl: "https://t", pollEvery: 0, fetch: fake(calls, polls, submitReply) });

test("success: fixed body, polls by id", async () => {
  const calls = [];
  const url = await client(calls, [{ id: "t1", status: "processing" }, { id: "t1", status: "success", images: ["https://cdn/x.gif"], watermarked: [false] }]).generate("a dancing cat");
  assert.equal(url, "https://cdn/x.gif");
  assert.equal(calls[0].url, "https://t/api/ai/generate");
  assert.deepEqual(calls[0].body, { provider: "openlux", mediaType: "image", model: "gif-maker-v1", scene: "text-to-image", prompt: "a dancing cat", options: { output_format: "gif" } });
  assert.equal(calls[0].headers.authorization, "Bearer sk-abc");
  assert.equal(calls[1].url, "https://t/api/ai/query");
  assert.deepEqual(calls[1].body, { taskId: "t1" });
  assert.equal(calls.length, 3);
});

test("queued keeps polling", async () => {
  const calls = [];
  const url = await client(calls, [
    { id: "t1", status: "processing", queued: true, queueEta: 40 },
    { id: "t1", status: "processing", queued: true, queueEta: 5 },
    { id: "t1", status: "success", images: ["https://cdn/q.gif"], watermarked: [true] },
  ]).generate("x");
  assert.equal(url, "https://cdn/q.gif");
  assert.equal(calls.length, 4);
});

test("failed carries errorMessage", async () => {
  await assert.rejects(client([], [{ status: "failed", errorMessage: "upstream error" }]).generate("x"),
    (e) => e instanceof GenerationFailedError && e.kind === "failed" && /upstream error/.test(e.message));
  await assert.rejects(client([], [{ status: "failed", errorMessage: "blocked", failureKind: "moderation" }]).generate("x"),
    (e) => e instanceof RejectedError);
});

test("timeout", async () => {
  const c = new Client({ apiKey: "sk", pollEvery: 0, timeout: 0, fetch: fake([], Array(5).fill({ status: "processing" })) });
  await assert.rejects(c.generate("x"), (e) => e.kind === "timeout");
});

test("invalid key -> AuthError", async () => {
  const r = { code: -1, message: "invalid API key — create one at https://aigifmaker.ai/settings/apikeys" };
  await assert.rejects(client([], [], r).submit("x"), (e) => e instanceof AuthError && e.message === r.message);
});

test("wall without key -> AuthError, no auth header", async () => {
  const calls = [];
  delete process.env.AIGIFMAKER_API_KEY;
  const c = new Client({ fetch: fake(calls, [], ok({ wall: true, reason: "anon_credits", cost: 1, remaining: 0, grant: 0 })) });
  await assert.rejects(c.submit("x"), (e) => e instanceof AuthError);
  assert.equal(calls[0].headers.authorization, undefined);
});

test("insufficient credits -> QuotaError", async () => {
  await assert.rejects(client([], [], { code: -1, message: "insufficient credits" }).submit("x"),
    (e) => e instanceof QuotaError && e.message.includes("https://aigifmaker.ai/pricing"));
});

test("cooldown -> RejectedError, other -> AigifmakerError", async () => {
  await assert.rejects(client([], [], { code: -2, message: "slow down" }).submit("x"), (e) => e instanceof RejectedError);
  await assert.rejects(client([], [], { code: -1, message: "prompt too long" }).submit("x"),
    (e) => e.constructor === AigifmakerError && e.kind === "other" && e.message === "prompt too long");
});

test("credits", async () => {
  assert.equal(await credits({ apiKey: "sk", fetch: fake([], []) }), 42);
  const bad = async () => new Response(JSON.stringify({ code: -1, message: "no auth, please sign in" }));
  await assert.rejects(credits({ apiKey: "sk", fetch: bad }), (e) => e instanceof AuthError);
});
