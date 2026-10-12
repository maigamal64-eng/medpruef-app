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
  MentorFinalEvent,
} from "@/lib/mentor/contract";
import { MENTOR_ERROR_STATUS, MENTOR_USAGE_STATES } from "@/lib/mentor/contract";
import { readMentorStream, toMentorEvent } from "./sse";

export type MentorClientError = MentorErrorCode | "network" | "unknown" | "mentor_resting" | "already_subscribed" | "pending_purchase";

export interface ApiFailure {
  ok: false;
  status: number;
  error: MentorClientError;
  retryAfterSeconds?: number;
  packagesUrl?: string;
  limit?: "minute" | "day";
  reason?: string;
  /** The server confirmed nothing was deducted (body credits_deducted:false). */
  notCharged?: boolean;
  /** MUX-23: the admission bar and balance from a 402 credits_exhausted. */
  admitMinCredits?: number;
  creditsLeft?: number;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export type MentorFetch = (
  input: string,
  init?: RequestInit & { timeoutMs?: number; skipAuthRedirect?: boolean },
) => Promise<Response>;

/** Time allowed until response headers of the chat call (the stream may run longer). */
export const CHAT_HEADERS_TIMEOUT_MS = 90_000;
export const SHORT_TIMEOUT_MS = 12_000;

const ERROR_CODES = new Set<string>([...Object.keys(MENTOR_ERROR_STATUS), "mentor_resting", "already_subscribed", "pending_purchase"]);

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
  let limit: "minute" | "day" | undefined;
  let reason: string | undefined;
  let notCharged = false;
  let gap: { admitMinCredits: number; creditsLeft: number } | null = null;
  try {
    const body = (await res.json()) as Partial<MentorErrorBody> | null;
    if (body && typeof body.error === "string" && ERROR_CODES.has(body.error)) error = body.error as MentorErrorCode;
    if (body && typeof body.retry_after_seconds === "number" && body.retry_after_seconds >= 0) {
      retryAfterSeconds = Math.ceil(body.retry_after_seconds);
    }
    if (body?.limit === "minute" || body?.limit === "day") limit = body.limit;
    if (typeof body?.reason === "string") reason = body.reason;
    if (body?.credits_deducted === false) notCharged = true;
    if (typeof body?.admit_min_credits === "number" && Number.isFinite(body.admit_min_credits) && typeof body.credits_left === "number" && Number.isFinite(body.credits_left)) gap = { admitMinCredits: body.admit_min_credits, creditsLeft: body.credits_left };
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
  if (limit) out.limit = limit;
  if (reason) out.reason = reason;
  if (notCharged) out.notCharged = true;
  if (gap) Object.assign(out, gap);
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
    Number.isFinite(u.credits_left) &&
    typeof u.messages_left_estimate === "number" &&
    Number.isFinite(u.messages_left_estimate) &&
    Array.isArray(u.sources) && Array.isArray(u.subscriptions) && typeof u.can_buy === "boolean"
  );
}

export interface MentorApi {
  deleteHistory?(signal?: AbortSignal): Promise<ApiResult<{ deleted: true }>>;
  history?(conversationId?: string, signal?: AbortSignal): Promise<ApiResult<{ thread: import("@/lib/mentor/thread").MentorThread }>>;
  usage(signal?: AbortSignal): Promise<ApiResult<{ usage: MentorUsageResponse }>>;
  packages(signal?: AbortSignal): Promise<ApiResult<{ packages: MentorPackagesResponse["packages"] }>>;
  checkout(req: MentorCheckoutRequest, signal?: AbortSignal): Promise<ApiResult<{ purchaseUrl: string; checkoutSessionId?: string }>>;
  verify(search: string, signal?: AbortSignal): Promise<ApiResult<{ verify: MentorCheckoutVerifyResponse }>>;
  result(clientRequestId: string, signal?: AbortSignal): Promise<ApiResult<{ status: "in_progress" | "complete" | "error" | "expired" | "missing"; final?: MentorFinalEvent; error?: MentorErrorCode }>>;
  report(req: { request_id: string; reason: MentorReportReason; details?: string }, signal?: AbortSignal): Promise<ApiResult<{ saved?: boolean }>>;
  question(questionId: number, signal?: AbortSignal): Promise<ApiResult<{ question: MentorReportedQuestion }>>;
  packageInterest?(signal?: AbortSignal): Promise<ApiResult<{ saved?: boolean }>>;
  waitlist(email: string, signal?: AbortSignal): Promise<ApiResult<{ saved?: boolean }>>;
  /** Streams one chat turn. Resolves after the stream ends; events arrive through onEvent. */
  chat(req: MentorChatRequest, onEvent: (e: MentorSseEvent) => void, signal?: AbortSignal): Promise<ApiResult<{ sawFinal: boolean; sawError: boolean }>>;
}

export type MentorReportReason = "date_wrong" | "rule_wrong" | "explanation_unclear" | "question_wrong" | "other";
export interface MentorReportedQuestion { id: number; question: string; explanation: string; topic: string }

const RESULT_POLL_MS = 2_500;
const RESULT_POLL_LIMIT_MS = 15 * 60 * 1000;

function waitForPoll(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/** Recovery only reads the original turn. It never creates or reserves another one. */
export async function recoverMentorTurn(
  api: Pick<MentorApi, "result">,
  clientRequestId: string,
  onEvent: (e: MentorSseEvent) => void,
  signal?: AbortSignal,
  wait = waitForPoll,
): Promise<"complete" | "failed" | "aborted"> {
  let knownRunning = false;
  for (let elapsed = 0; elapsed <= RESULT_POLL_LIMIT_MS; elapsed += RESULT_POLL_MS) {
    if (signal?.aborted) return "aborted";
    const r = await api.result(clientRequestId, signal);
    if (signal?.aborted) return "aborted";
    if (r.ok && r.status === "complete" && r.final) { onEvent(r.final); return "complete"; }
    if (r.ok && r.status !== "in_progress") {
      if (r.error) onEvent({ type: "error", error: r.error });
      return "failed";
    }
    if (!r.ok && (!knownRunning || (r.error !== "network" && r.error !== "upstream_error"))) return "failed";
    knownRunning = true;
    onEvent({ type: "in_progress", client_request_id: clientRequestId });
    await wait(RESULT_POLL_MS, signal);
  }
  return "failed";
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
    async deleteHistory(signal) {
      const r = await getJson<{ ok?: boolean }>(f, "/api/mentor/chat/history", signal, { method: "DELETE" });
      return r.ok && r.data.ok === true ? { ok: true, deleted: true } : r.ok ? { ok: false, status: 200, error: "unknown" } : r;
    },
    async history(conversationId, signal) {
      const r = await getJson<import("@/lib/mentor/thread").MentorThread>(f, `/api/mentor/chat/history${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ""}`, signal);
      if (!r.ok) return r;
      if (!r.data || !Array.isArray(r.data.messages) || r.data.messages.some(m => !m || typeof m.id !== "string" || typeof m.text !== "string" || (m.role !== "user" && m.role !== "assistant")) || (r.data.conversation_id !== null && typeof r.data.conversation_id !== "string")) return {ok:false,status:200,error:"unknown"};
      const messages = r.data.messages.map(m => { const final = toMentorEvent(m.final); return {...m,final:final?.type === "final" ? final : undefined}; });
      return { ok: true, thread: {...r.data,messages} };
    },

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
      const id = r.data?.checkout_session_id;
      if (!isSafePurchaseUrl(url) || typeof id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return { ok: false, status: 200, error: "unknown" };
      return { ok: true, purchaseUrl: url, checkoutSessionId: id };
    },

    async verify(search, signal) {
      // The verify route's query parameters are not frozen in the contract, so
      // whatever Whop appended to the return URL is forwarded untouched.
      const qs = search && search.startsWith("?") ? search : "";
      const r = await getJson<Partial<MentorCheckoutVerifyResponse>>(f, `/api/mentor/checkout/verify${qs}`, signal);
      if (!r.ok) return r;
      const status = r.data?.status;
      if (status !== "granted" && status !== "pending" && status !== "failed") return { ok: false, status: 200, error: "unknown" };
      if (status === "granted" && (typeof r.data?.credits_added !== "number" || !Number.isFinite(r.data.credits_added) || r.data.credits_added <= 0)) return { ok: false, status: 200, error: "unknown" };
      const receipt = r.data.receipt;
      const validReceipt = receipt && ["mentor_basis", "mentor_plus", "mentor_topup"].includes(receipt.package_id)
        && Number.isFinite(receipt.credits) && receipt.credits > 0 && Number.isFinite(Date.parse(receipt.expires_at))
        && (receipt.renews_at === null || (typeof receipt.renews_at === "string" && Number.isFinite(Date.parse(receipt.renews_at))));
      if (receipt && !validReceipt) return { ok: false, status: 200, error: "unknown" };
      const credits = typeof r.data?.credits_left === "number" ? r.data.credits_left : 0;
      const added = typeof r.data?.credits_added === "number" && Number.isFinite(r.data.credits_added) ? Math.max(0, Math.floor(r.data.credits_added)) : 0;
      return { ok: true, verify: { status, credits_left: credits, credits_added: added, ...(r.data.receipt ? { receipt: r.data.receipt } : {}) } };
    },

    async result(clientRequestId, signal) {
      const r = await getJson<Record<string, unknown>>(f, `/api/mentor/chat/result?client_request_id=${encodeURIComponent(clientRequestId)}`, signal);
      if (!r.ok) return r;
      const status = r.data.status;
      if (!["in_progress", "complete", "error", "expired", "missing"].includes(String(status))) return { ok: false, status: 200, error: "unknown" };
      const final = toMentorEvent(r.data.final);
      if (status === "complete" && final?.type !== "final") return { ok: false, status: 200, error: "unknown" };
      return { ok: true, status: status as "in_progress" | "complete" | "error" | "expired" | "missing", ...(final?.type === "final" ? { final } : {}), ...(typeof r.data.error === "string" && ERROR_CODES.has(r.data.error) ? { error: r.data.error as MentorErrorCode } : {}) };
    },

    async report(req, signal) {
      const r = await getJson<{ ok?: boolean }>(f, "/api/mentor/report", signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      return r.ok && r.data.ok === true ? { ok: true } : r.ok ? { ok: false, status: 200, error: "unknown" } : r;
    },

    async question(questionId, signal) {
      for (const exam of ["kenntnispruefung", "kmp_innsbruck", "pharma"]) {
        const r = await getJson<unknown>(f, `/api/questions?ids=${questionId}&examSource=${exam}&limit=1`, signal);
        if (!r.ok) return r;
        if (!Array.isArray(r.data)) continue;
        const q = r.data.find((x) => !!x && typeof x === "object" && Number(x.id) === questionId);
        if (q && typeof q.question === "string") return { ok: true, question: { id: questionId, question: q.question, explanation: typeof q.explanation === "string" ? q.explanation : "", topic: typeof q.topic === "string" ? q.topic : "" } };
      }
      return { ok: false, status: 404, error: "unknown" };
    },

    async packageInterest(signal) {
      let response: Response;
      try {
        response = await f("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "mentor_packages" }), signal, skipAuthRedirect: true, timeoutMs: SHORT_TIMEOUT_MS });
        const body = await response.json();
        if ((response.ok || response.status === 409) && body?.ok === true) return { ok: true, saved: true };
      } catch { return networkFailure(); }
      return failureFromResponse(response);
    },
    async waitlist(email, signal) {
      let response: Response;
      try {
        response = await f("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, tier_interest: "unknown", source: "mentor_resting" }), signal, skipAuthRedirect: true, timeoutMs: SHORT_TIMEOUT_MS });
        const body = await response.json();
        if ((response.ok || response.status === 409) && body?.ok === true) return { ok: true };
      } catch { return networkFailure(); }
      return failureFromResponse(response);
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
