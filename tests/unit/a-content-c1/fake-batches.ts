/**
 * In-memory Message Batches API for a-content-c1 tests. Each request is
 * answered by `respond(custom_id, params)`; batches end on demand.
 */
import { BATCHES_URL } from "../../../scripts/ai-batch/runner";

export interface FakeAnswer {
  text: string;
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  errored?: boolean;
}

export type Responder = (custom_id: string, params: Record<string, unknown>) => FakeAnswer;

export function fakeBatches(respond: Responder) {
  const batches = new Map<string, { requests: Array<{ custom_id: string; params: Record<string, unknown> }>; ended: boolean }>();
  const calls: Array<{ method: string; url: string; body?: { requests?: Array<{ custom_id: string; params: Record<string, unknown> }> }; headers: Record<string, string> }> = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = String(init.method);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers: init.headers as Record<string, string> });
    if (method === "POST" && url === BATCHES_URL) {
      const id = `msgbatch_${++n}`;
      batches.set(id, { requests: body.requests, ended: false });
      return new Response(JSON.stringify({ id, processing_status: "in_progress" }), { status: 200 });
    }
    if (method === "GET" && url.startsWith(`${BATCHES_URL}?`)) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    const m = /\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(url);
    if (m && method === "GET") {
      const b = batches.get(m[1]);
      if (!b) return new Response("nope", { status: 404 });
      if (!m[2]) return new Response(JSON.stringify({ id: m[1], processing_status: b.ended ? "ended" : "in_progress", results_url: b.ended ? `${BATCHES_URL}/${m[1]}/results` : null }), { status: 200 });
      const lines = b.requests.map((r) => {
        const a = respond(r.custom_id, r.params);
        if (a.errored) return JSON.stringify({ custom_id: r.custom_id, result: { type: "errored", error: { type: "error", error: { type: "overloaded_error" } } } });
        return JSON.stringify({
          custom_id: r.custom_id,
          result: {
            type: "succeeded",
            message: {
              model: a.model ?? String(r.params.model),
              stop_reason: a.stop_reason ?? "end_turn",
              content: [{ type: "thinking", thinking: "" }, { type: "text", text: a.text }],
              usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(a.usage ?? { input_tokens: 1200, output_tokens: 300 }) },
            },
          },
        });
      });
      return new Response(lines.join("\n") + "\n", { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls, batches, endAll: () => batches.forEach((b) => (b.ended = true)), posts: () => calls.filter((c) => c.method === "POST") };
}
