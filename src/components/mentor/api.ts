/**
 * Mentor API client (W2-UI). Framework-free and fetch-injected so it runs
 * under vitest and against fixtures. Real callers pass `authFetch`
 * (see client.ts); tests pass a fake.
 *
 * Failure model: every call resolves to `{ok:true,...}` or an `ApiFailure`.
 * Nothing throws into the UI. A missing route (404) is reported as
 * `mentor_disabled`: until the server ships the route, the mentor is simply
 * not available, which the UI already has copy for.
 */

import type {
  MentorChatRequest,
  MentorCheckoutRequest,
  MentorCheckoutResponse,
  MentorCheckoutVerifyResponse,
  MentorErrorBody,
  MentorErrorCode,
  MentorPackagesResponse,
  MentorSseEvent,
  MentorUsageResponse,
} from "@/lib/mentor/contract";
import { MENTOR_ERROR_STATUS, MENTOR_USAGE_STATES } from "@/lib/mentor/contract";
import { readMentorStream, toMentorEvent } from "./sse";

export type MentorClientError = MentorErrorCode | "network" | "unknown";

export interface ApiFailure {
  ok: false;
  status: number;
  error: MentorClientError;
  retryAfterSeconds?: number;
  packagesUrl?: string;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export type MentorFetch = (
  input: string,
  init?: RequestInit & { timeoutMs?: number; skipAuthRedirect?: boolean },
) => Promise<Response>;

/** Time allowed until response headers of the chat call (the stream may run longer). */
export const CHAT_HEADERS_TIMEOUT_MS = 90_000;
export const SHORT_TIMEOUT_MS = 12_000;

const ERROR_CODES = new Set<string>(Object.keys(MENTOR_ERROR_STATUS));

function statusToError(status: number): MentorClientError {
  if (status === 400) return "invalid_input";
  if (status === 401) return "unauthenticated";
  if (status === 402) return "credits_required";
  if (status === 403) return "mentor_disabled";
  if (status === 404) return "mentor_disabled";
  if (status === 413) return "input_too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_error";
  return "unknown";
}

/** Build a failure from a non-2xx response. Never throws. */
export async function failureFromResponse(res: Response): Promise<ApiFailure> {
  let error: MentorClientError = statusToError(res.status);
  let retryAfterSeconds: number | undefined;
  let packagesUrl: string | undefined;
  try {
    const body = (await res.json()) as Partial<MentorErrorBody> | null;
    if (body && typeof body.error === "string" && ERROR_CODES.has(body.error)) error = body.error as MentorErrorCode;
    if (body && typeof body.retry_after_seconds === "number" && body.retry_after_seconds >= 0) {
      retryAfterSeconds = Math.ceil(body.retry_after_seconds);
    }
    if (body && typeof body.packages_url === "string" && body.packages_url.startsWith("/")) packagesUrl = body.packages_url;
  } catch {
    /* non-JSON body: keep the status mapping */
  }
  if (retryAfterSeconds === undefined && res.status === 429) {
    const h = Number(res.headers.get("retry-after"));
    if (Number.isFinite(h) && h >= 0) retryAfterSeconds = Math.ceil(h);
  }
  const out: ApiFailure = { ok: false, status: res.status, error };
  if (retryAfterSeconds !== undefined) out.retryAfterSeconds = retryAfterSeconds;
  if (packagesUrl) out.packagesUrl = packagesUrl;
  return out;
}

function networkFailure(): ApiFailure {
  return { ok: false, status: 0, error: "network" };
}

async function getJson<T>(f: MentorFetch, url: string, signal?: AbortSignal, init?: RequestInit): Promise<ApiResult<{ data: T }>> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal, skipAuthRedirect: true, timeoutMs: SHORT_TIMEOUT_MS });
  } catch {
    return networkFailure();
  }
  if (!res.ok) return failureFromResponse(res);
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: res.status, error: "unknown" };
  }
}

function isUsage(x: unknown): x is MentorUsageResponse {
  if (!x || typeof x !== "object") return false;
  const u = x as Record<string, unknown>;
  return (
    typeof u.state === "string" &&
    (MENTOR_USAGE_STATES as readonly string[]).includes(u.state) &&
    typeof u.credits_left === "number" &&
    typeof u.messages_left_estimate === "number"
  );
}

export interface MentorApi {
  usage(signal?: AbortSignal): Promise<ApiResult<{ usage: MentorUsageResponse }>>;
  packages(signal?: AbortSignal): Promise<ApiResult<{ packages: MentorPackagesResponse["packages"] }>>;
  checkout(req: MentorCheckoutRequest, signal?: AbortSignal): Promise<ApiResult<{ purchaseUrl: string }>>;
  verify(search: string, signal?: AbortSignal): Promise<ApiResult<{ verify: MentorCheckoutVerifyResponse }>>;
  /** Streams one chat turn. Resolves after the stream ends; events arrive through onEvent. */
  chat(req: MentorChatRequest, onEvent: (e: MentorSseEvent) => void, signal?: AbortSignal): Promise<ApiResult<{ sawFinal: boolean; sawError: boolean }>>;
}

/** Only same-origin-looking, https purchase links are followed. */
export function isSafePurchaseUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createMentorApi(f: MentorFetch): MentorApi {
  return {
    async usage(signal) {
      const r = await getJson<unknown>(f, "/api/mentor/usage", signal);
      if (!r.ok) return r;
      return isUsage(r.data) ? { ok: true, usage: r.data } : { ok: false, status: 200, error: "unknown" };
    },

    async packages(signal) {
      const r = await getJson<Partial<MentorPackagesResponse>>(f, "/api/mentor/packages", signal);
      if (!r.ok) return r;
      const list = Array.isArray(r.data?.packages) ? r.data.packages : [];
      return { ok: true, packages: list };
    },

    async checkout(req, signal) {
      const r = await getJson<Partial<MentorCheckoutResponse>>(f, "/api/mentor/checkout", signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) return r;
      const url = r.data?.purchase_url;
      return isSafePurchaseUrl(url) ? { ok: true, purchaseUrl: url } : { ok: false, status: 200, error: "unknown" };
    },

    async verify(search, signal) {
      // The verify route's query parameters are not frozen in the contract, so
      // whatever Whop appended to the return URL is forwarded untouched.
      const qs = search && search.startsWith("?") ? search : "";
      const r = await getJson<Partial<MentorCheckoutVerifyResponse>>(f, `/api/mentor/checkout/verify${qs}`, signal);
      if (!r.ok) return r;
      const status = r.data?.status;
      if (status !== "granted" && status !== "pending" && status !== "failed") return { ok: false, status: 200, error: "unknown" };
      const credits = typeof r.data?.credits_left === "number" ? r.data.credits_left : 0;
      return { ok: true, verify: { status, credits_left: credits } };
    },

    async chat(req, onEvent, signal) {
      let res: Response;
      try {
        res = await f("/api/mentor/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(req),
          signal,
          skipAuthRedirect: true,
          timeoutMs: CHAT_HEADERS_TIMEOUT_MS,
        });
      } catch {
        return networkFailure();
      }
      if (!res.ok) return failureFromResponse(res);

      let sawFinal = false;
      let sawError = false;
      const wrap = (e: MentorSseEvent) => {
        if (e.type === "final") sawFinal = true;
        if (e.type === "error") sawError = true;
        onEvent(e);
      };

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || !res.body) {
        try {
          const evt = toMentorEvent(await res.json());
          if (evt) wrap(evt);
        } catch {
          /* fall through to the no-final handling below */
        }
        return { ok: true, sawFinal, sawError };
      }

      try {
        await readMentorStream(res.body, wrap, signal);
      } catch {
        if (signal?.aborted) return { ok: true, sawFinal, sawError };
        return { ok: false, status: res.status, error: "network" };
      }
      return { ok: true, sawFinal, sawError };
    },
  };
}
