// Free live smoke tests against https://aigifmaker.ai. No generation runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, credits, submit } from "./dist/mod.js";

delete process.env.AIGIFMAKER_API_KEY;

test("invalid key -> AuthError", async () => {
  await assert.rejects(credits({ apiKey: "sk-invalidtest000" }), (e) => e instanceof AuthError);
});

test("no key -> wall -> AuthError", async () => {
  await assert.rejects(submit("smoke test: a blinking star"), (e) => e instanceof AuthError);
});
