# aigifmaker

Turn text into animated GIFs with AI GIF Maker. Native GIF generation — no video conversion. Type what you want and download your GIF in about a minute.

This is the official TypeScript / JavaScript client for [AI GIF Maker](https://aigifmaker.ai/?utm_source=npm&utm_medium=package), for Node 18+, Deno and Bun. One call sends your prompt, waits for the GIF and resolves to its URL.

```bash
npm install aigifmaker
# Deno / JSR
deno add jsr:@aigifmaker/aigifmaker
```

```ts
import { generate } from "aigifmaker";

const url = await generate("a corgi in sunglasses dancing on a beach, looping");
console.log(url); // the finished GIF
```

Uses the global `fetch`, no runtime dependencies.

## API key

Create a key at https://aigifmaker.ai/settings/apikeys, then pass it as `apiKey` or set it in the environment:

```bash
export AIGIFMAKER_API_KEY=sk-...
```

Each GIF costs 1 credit on your AI GIF Maker account, the same as on the website. New accounts get one free GIF (it carries a small aigifmaker.ai badge). A GIF that fails to generate gives its credit back. Credit packs are on the [pricing](https://aigifmaker.ai/pricing?utm_source=npm&utm_medium=package) page.

```ts
import { credits } from "aigifmaker";
console.log(await credits()); // remaining credits, free to call
```

## Client

```ts
import { Client } from "aigifmaker";

const gif = new Client({ apiKey: "sk-...", timeout: 900_000 }); // milliseconds, 15 minutes by default
const url = await gif.generate("a tiny dragon sneezing a puff of glitter");
```

## Submit now, collect later

```ts
const id = await gif.submit("happy birthday text bouncing in rainbow letters");
console.log((await gif.status(id)).status); // pending | processing | success | failed
const url = await gif.wait(id);              // polls every 3 seconds
```

A run from an account that has not bought credits yet may wait in a short queue first (`queued: true` while `status` stays `processing`). That is normal; `generate()` and `wait()` keep polling.

## Errors worth catching

Every failure is an `AigifmakerError`; check the subclass or `kind`:

- `AuthError` (`auth`): no key, or the key is wrong or deleted
- `QuotaError` (`quota`): the account is out of credits
- `RejectedError` (`rejected`): the content filter refused the prompt, or a cooldown is active; reword it
- `GenerationFailedError` (`failed`): the run was accepted but failed; the message says why
- `timeout`, `other`: anything else, with the server's message

## Tests

```bash
npm run build && npm test   # mocked, offline
npm run smoke                # two free live checks, no generation
```

MIT licensed. Questions: support@aigifmaker.ai
