import type { FilingUniversity, MentorFact } from './seam';
import { isInternalFactId } from './validator';

function officialHost(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.hostname : null; } catch { return null; }
}

/** Refusal destinations and their labels have one verified row as owner. */
export function refusalOffice(rows: MentorFact[], desiredUrl?: string, university?: Exclude<FilingUniversity,'all'>): { url: string; label: string } | null {
  const verified = rows.filter(f => f.verdict === 'confirmed' && f.status === 'live' && !isInternalFactId(f.id) && f.source_label.trim() && officialHost(f.source_url));
  const matching = university ? verified.filter(f => f.filing_university === university) : verified;
  // The verified row can use a newer path than the resources directory. Prefer
  // the reason-owned URL/host, then a verified result of the reason's search.
  const desiredHost = desiredUrl ? officialHost(desiredUrl) ?? undefined : undefined;
  const row = matching.find(f => f.source_url === desiredUrl) ?? matching.find(f => desiredHost && officialHost(f.source_url) === desiredHost) ?? matching[0];
  return row ? { url: row.source_url, label: row.source_label } : null;
}
