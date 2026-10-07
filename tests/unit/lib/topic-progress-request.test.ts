import { describe, expect, it, vi } from "vitest";
import { startTopicProgressRequest } from "@/lib/topic-progress-request";

describe("topic progress request ownership", () => {
  it("keeps the newer exam when the old request resolves last", async () => {
    let oldResolve!: (response: Response) => void;
    const publish = vi.fn();
    const old = startTopicProgressRequest("pharma", () => new Promise<Response>(resolve => { oldResolve = resolve; }), publish, vi.fn());
    old.cancel();
    const current = startTopicProgressRequest("kenntnispruefung", async () => new Response(JSON.stringify([{ topic:"current exam", total:42, answered:7, accuracy:71 }])), publish, vi.fn());
    await current.done;
    oldResolve(new Response(JSON.stringify([{ topic:"stale exam", total:10, answered:5, accuracy:50 }])));
    await old.done;
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0][0].topic).toBe("current exam");
  });
  it("does not publish an old exam response after cancellation even if fetch ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = () => new Promise<Response>(r => { resolve = r; });
    const onData = vi.fn();
    const request = startTopicProgressRequest("pharma", fetcher, onData, vi.fn());
    request.cancel();
    resolve(new Response(JSON.stringify([{ topic:"old", total:10, answered:5, accuracy:50 }])));
    await request.done;
    expect(onData).not.toHaveBeenCalled();
  });
  it.each([new Response('{"error":"timeout"}', {status:503}), new Response('{"error":"unexpected"}')])("surfaces unavailable progress instead of publishing malformed data", async response => {
    const onError = vi.fn(), onData = vi.fn();
    const request = startTopicProgressRequest("pharma", async () => response, onData, onError);
    await request.done;
    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
