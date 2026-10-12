import { createActionGate } from './account-request';
export function createFeedbackSubmission(post: (body: { reason: string; details?: string; url?: string }) => Promise<Response>) {
  const gate = createActionGate();
  return {
    pending: () => !gate.available(),
    async send(reason: string, details: string, url?: string): Promise<'saved' | 'failed' | 'pending'> {
      if (!gate.enter()) return 'pending';
      try {
        const response = await post({ reason, details: details.trim() || undefined, url });
        return response.ok ? 'saved' : 'failed';
      } catch { return 'failed'; }
      finally { gate.leave(); }
    },
  };
}
