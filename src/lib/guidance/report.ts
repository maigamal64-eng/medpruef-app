export async function submitFactReport(pageId: string, factId: string | undefined, message: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (message.trim().length < 3 || message.length > 2000) return false;
  try {
    const response = await fetcher("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), context: { source: "guidance", pageId, ...(factId ? { factId } : {}) } }),
    });
    return response.ok;
  } catch { return false; }
}
export function factReportMailto(pageId: string, message: string): string {
  const address = ["[name]", "medpruf.com"].join("@");
  return `mailto:${address}?subject=${encodeURIComponent(`Guidance: ${pageId}`)}&body=${encodeURIComponent(message)}`;
}
