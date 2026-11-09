// Official SDK for AI GIF Maker (aigifmaker.ai): turn text into animated GIFs. See README.md.

/** The service this module talks to. */
export const BASE_URL = "https://aigifmaker.ai";
/** Where users create API keys. */
export const KEYS_URL = "https://aigifmaker.ai/settings/apikeys";
/** Where users buy credits. */
export const PRICING_URL = "https://aigifmaker.ai/pricing";

/** The fixed request body; only `prompt` changes. */
const GIF_REQUEST = {
  provider: "openlux",
  mediaType: "image",
  model: "gif-maker-v1",
  scene: "text-to-image",
  options: { output_format: "gif" },
} as const;

/**
 * What went wrong, so callers can decide what to do next.
 * auth: no or bad key · quota: out of credits · rejected: content filter or cooldown, reword ·
 * failed: the run was accepted but failed · timeout · other
 */
export type ErrorKind = "auth" | "quota" | "rejected" | "failed" | "timeout" | "other";

/** Every failure is an AigifmakerError; branch on `kind` or on the subclass. */
export class AigifmakerError extends Error {
  constructor(message: string, readonly kind: ErrorKind = "other", readonly code?: number) {
    super(message);
    this.name = "AigifmakerError";
  }
}
/** No API key, or the key is invalid or deleted. */
export class AuthError extends AigifmakerError {
  constructor(message: string, code?: number) {
    super(message, "auth", code);
    this.name = "AuthError";
  }
}
/** The account is out of credits. */
export class QuotaError extends AigifmakerError {
  constructor(message: string, code?: number) {
    super(message, "quota", code);
    this.name = "QuotaError";
  }
}
/** The content filter refused the prompt, or a cooldown is active. Reword it. */
export class RejectedError extends AigifmakerError {
  constructor(message: string, code?: number) {
    super(message, "rejected", code);
    this.name = "RejectedError";
  }
}
/** The run was accepted but ended as failed or canceled. */
export class GenerationFailedError extends AigifmakerError {
  constructor(message: string) {
    super(message, "failed");
    this.name = "GenerationFailedError";
  }
}

/** Connection options shared by every call. */
export interface ClientOptions {
  /** Defaults to the `AIGIFMAKER_API_KEY` environment variable. */
  apiKey?: string;
  baseUrl?: string;
  /** Milliseconds `generate` / `wait` keep polling. Default 5 minutes. */
  timeout?: number;
  /** Milliseconds between polls. Default 3 seconds. */
  pollEvery?: number;
  fetch?: typeof fetch;
}

/** The task record returned by `status`. */
export interface TaskStatus {
  id: string;
  status: "pending" | "processing" | "success" | "failed" | "canceled" | string;
  /** `images[0]` is the GIF URL once `status` is success. */
  images?: string[];
  watermarked?: boolean[];
  /** True while a run from an account without purchased credits waits its turn. */
  queued?: boolean;
  /** Seconds left in the queue. */
  queueEta?: number;
  errorMessage?: string;
  failureKind?: string;
  refundNote?: string;
  [k: string]: unknown;
}

function envKey(): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  try {
    return g.process?.env?.AIGIFMAKER_API_KEY ?? g.Deno?.env?.get("AIGIFMAKER_API_KEY");
  } catch {
    return undefined; // Deno without --allow-env
  }
}

/** Turn an API envelope into `data`, or throw the error that says what to do next. */
// deno-lint-ignore no-explicit-any
export function unwrap(body: any): Record<string, any> {
  const code = body?.code;
  const data = body?.data && typeof body.data === "object" ? body.data : {};
  if (code === 0) {
    if (data.wall) throw new AuthError(`an API key is required; create one at ${KEYS_URL} and set AIGIFMAKER_API_KEY`, 0);
    return data;
  }
  const msg = String(body?.message ?? body?.error ?? "unexpected response");
  const n = typeof code === "number" ? code : undefined;
  if (/invalid api key|no auth/i.test(msg)) throw new AuthError(msg, n);
  if (/insufficient credits/i.test(msg)) throw new QuotaError(`${msg}. Top up at ${PRICING_URL}`, n);
  if (n !== undefined && n !== -1) throw new RejectedError(msg, n);
  throw new AigifmakerError(msg, "other", n);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A client bound to one API key. */
export class Client {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly pollEvery: number;
  private readonly fetchImpl: typeof fetch;

  constructor(o: ClientOptions = {}) {
    this.apiKey = o.apiKey || envKey() || undefined;
    this.baseUrl = (o.baseUrl ?? BASE_URL).replace(/\/$/, "");
    this.timeout = o.timeout ?? 300_000;
    this.pollEvery = o.pollEvery ?? 3_000;
    this.fetchImpl = o.fetch ?? ((...a) => fetch(...a));
  }

  // deno-lint-ignore no-explicit-any
  private async post(path: string, body: unknown): Promise<Record<string, any>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(this.baseUrl + path, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new AigifmakerError(`aigifmaker.ai returned a non-JSON response (HTTP ${res.status})`);
    }
    return unwrap(json);
  }

  /** Start one GIF and resolve to its task id without waiting. */
  async submit(prompt: string): Promise<string> {
    if (!prompt?.trim()) throw new TypeError("prompt is required");
    const data = await this.post("/api/ai/generate", { ...GIF_REQUEST, prompt });
    if (!data.id) throw new AigifmakerError("the service returned no task id");
    return String(data.id);
  }

  /** Fetch the task record: `status` is pending, processing, success or failed; `images[0]` is the GIF. */
  async status(taskId: string): Promise<TaskStatus> {
    return (await this.post("/api/ai/query", { taskId })) as TaskStatus;
  }

  /** Poll a task until it finishes and resolve to the GIF URL. */
  async wait(taskId: string): Promise<string> {
    const deadline = Date.now() + this.timeout;
    while (true) {
      let d: TaskStatus | undefined;
      try {
        d = await this.status(taskId);
      } catch (e) {
        if (e instanceof AigifmakerError) throw e;
        // a dropped poll is not a failed generation
      }
      if (d?.status === "success" && d.images?.length) return String(d.images[0]);
      if (d?.status === "failed" || d?.status === "canceled") {
        const msg = d.errorMessage || `the GIF ${d.status}`;
        throw d.failureKind === "moderation" ? new RejectedError(msg) : new GenerationFailedError(msg);
      }
      if (Date.now() >= deadline) {
        throw new AigifmakerError(`still running; task ${taskId} may finish later in your AI GIF Maker history`, "timeout");
      }
      await sleep(this.pollEvery);
    }
  }

  /** Generate one animated GIF and resolve to its URL. */
  async generate(prompt: string): Promise<string> {
    return this.wait(await this.submit(prompt));
  }

  /** Remaining credits on the account. Free to call. */
  async credits(): Promise<number> {
    return Number((await this.post("/api/user/get-user-credits", {})).remainingCredits ?? 0);
  }
}

/** Generate one animated GIF and resolve to its URL. */
export function generate(prompt: string, o: ClientOptions = {}): Promise<string> {
  return new Client(o).generate(prompt);
}
/** Start one GIF and resolve to its task id. */
export function submit(prompt: string, o: ClientOptions = {}): Promise<string> {
  return new Client(o).submit(prompt);
}
/** Fetch the task record for `taskId`. */
export function status(taskId: string, o: ClientOptions = {}): Promise<TaskStatus> {
  return new Client(o).status(taskId);
}
/** Poll a task until it finishes and resolve to the GIF URL. */
export function wait(taskId: string, o: ClientOptions = {}): Promise<string> {
  return new Client(o).wait(taskId);
}
/** Remaining credits on the account. */
export function credits(o: ClientOptions = {}): Promise<number> {
  return new Client(o).credits();
}
