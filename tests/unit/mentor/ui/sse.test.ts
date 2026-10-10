import { describe, it, expect } from "vitest";
import { createMentorStreamParser, readMentorStream, toMentorEvent } from "@/components/mentor/sse";
import { FIXTURE_STREAM_OK, FIXTURE_STREAM_REFUSED, FIXTURE_STREAM_MIDWAY_ERROR, FIXTURE_FINAL_VALIDATOR } from "@/lib/mentor/fixtures";
import type { MentorSseEvent } from "@/lib/mentor/contract";

const enc = new TextEncoder();

function serialize(events: MentorSseEvent[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

async function parseChunks(chunks: Uint8Array[]): Promise<MentorSseEvent[]> {
  const out: MentorSseEvent[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((x) => c.enqueue(x));
      c.close();
    },
  });
  await readMentorStream(body, (e) => out.push(e));
  return out;
}

describe("mentor stream parser", () => {
  it("parses the contract fixtures", async () => {
    for (const stream of [FIXTURE_STREAM_OK, FIXTURE_STREAM_REFUSED, FIXTURE_STREAM_MIDWAY_ERROR]) {
      const got = await parseChunks([enc.encode(serialize(stream))]);
      expect(got).toEqual(stream);
    }
  });

  it("is identical when the bytes are split at every offset, including inside multi-byte characters", async () => {
    const stream: MentorSseEvent[] = [
      { type: "delta", text: "Prüfung für Ärzte, äöü ß, 日本" },
      FIXTURE_FINAL_VALIDATOR,
    ];
    const bytes = enc.encode(serialize(stream));
    for (let i = 1; i < bytes.length; i++) {
      const got = await parseChunks([bytes.slice(0, i), bytes.slice(i)]);
      expect(got).toEqual(stream);
    }
  });

  it("accepts newline-delimited JSON, comments, CRLF, event lines and [DONE]", () => {
    const got: MentorSseEvent[] = [];
    const p = createMentorStreamParser((e) => got.push(e));
    p.push(": keep-alive\r\nevent: message\r\ndata: {\"type\":\"delta\",\"text\":\"a\"}\r\n\r\n");
    p.push('{"type":"delta","text":"b"}\n');
    p.push("data: [DONE]\n\n");
    p.end();
    expect(got).toEqual([
      { type: "delta", text: "a" },
      { type: "delta", text: "b" },
    ]);
  });

  it("flushes a last event that has no closing blank line", () => {
    const got: MentorSseEvent[] = [];
    const p = createMentorStreamParser((e) => got.push(e));
    p.push('data: {"type":"delta","text":"x"}');
    expect(got).toEqual([]);
    p.end();
    expect(got).toEqual([{ type: "delta", text: "x" }]);
  });

  it("drops torn or unknown frames without throwing", () => {
    const got: MentorSseEvent[] = [];
    const p = createMentorStreamParser((e) => got.push(e));
    p.push('data: {"type":"delta","te\n\n');
    p.push('data: {"type":"mystery"}\n\n');
    p.push("data: not json\n\n");
    p.end();
    expect(got).toEqual([]);
  });

  it("maps an unknown error code to upstream_error and keeps known ones", () => {
    expect(toMentorEvent({ type: "error", error: "credits_exhausted" })).toEqual({ type: "error", error: "credits_exhausted" });
    expect(toMentorEvent({ type: "error", error: "weird" })).toEqual({ type: "error", error: "upstream_error" });
  });

  it("rejects a final without conversation id or blocks, and cleans malformed citations", () => {
    expect(toMentorEvent({ type: "final" })).toBeNull();
    const f = toMentorEvent({
      type: "final",
      conversation_id: "c1",
      answer_blocks: [{ text: "ok", fact_ids: ["a", 5] }, { nope: 1 }],
      citations: [{ fact_id: "a", source_url: "https://x.test", source_label: "L", read_on: "2026-10-10" }, { fact_id: 3 }],
      credits_left: 7,
      messages_left_estimate: "x",
    });
    expect(f).toMatchObject({
      type: "final",
      answer_blocks: [{ text: "ok", fact_ids: ["a"] }],
      credits_left: 7,
      messages_left_estimate: 0,
    });
    expect((f as { citations: unknown[] }).citations).toHaveLength(1);
  });
});
