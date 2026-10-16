// a35 release smoke only: a local stand-in for the Supabase REST endpoint so
// server-rendered pages build and render without any production contact.
// get_topic_counts answers with fixture counts; every other request with [].
//   node tests/e2e/master-plan/release/supabase-stand-in.mjs [port]
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 54398);
const COUNTS = [
  { topic: "Neurologie", count: 420 }, { topic: "Kardiologie", count: 380 }, { topic: "Chirurgische Fächer", count: 510 },
  { topic: "Dermatologie", count: 210 }, { topic: "Pharmakologie", count: 322 },
];
let hits = 0;
createServer((req, res) => {
  // The smoke's preflight reads this counter to prove the server under test
  // talks to the stand-in and not to a real Supabase project.
  if (req.url === "/__a35/hits") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ hits })); }
  hits++;
  // a-free-credit-hooks: one live campaign code for the /gratis smoke; every other code is unknown.
  // a-seed-seats: one live seat code (SEAT-REZ, 30 Pro days, 200 credits); TG-SPT reads as a credits code.
  if (req.url?.includes("/ai_credit_campaign?")) {
    const seat = req.url.includes("code=eq.SEAT-REZ");
    const live = seat || req.url.includes("code=eq.TG-SPT");
    const row = seat
      ? { code: "SEAT-REZ", kind: "seat", pro_days: 30, credits: 200, expiry_days: 30, starts_at: "2026-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z", active: true }
      : { code: "TG-SPT", kind: "credits", pro_days: null, credits: 100, expiry_days: 60, starts_at: "2026-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z", active: true };
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (single && !live) { res.writeHead(406, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: "PGRST116", message: "0 rows" })); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(single ? row : live ? [row] : []));
  }
  // a-sitting-one-tap: the account behind the synthetic one-tap sitting link.
  if (req.method === "GET" && req.url?.includes("/users?") && req.url.includes("id=eq.00000000-0000-4000-8000-000000517710")) {
    const row = { id: "00000000-0000-4000-8000-000000517710", email: "sitting@example.invalid", email_status: null, role: "user", tier: "free", tier_expires_at: null, is_banned: false, active_exam: "kenntnispruefung", exam_date: null, session_invalidated_at: null };
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(single ? row : [row]));
  }
  // a-email-confirm-trial: the unconfirmed email account behind the synthetic confirmation link.
  if (req.url?.includes("/users?") && req.url.includes("id=eq.00000000-0000-4000-8000-0000000ec001")) {
    const row = { id: "00000000-0000-4000-8000-0000000ec001", email: "confirm@example.invalid", email_verified_at: null, first_name: "Fixture", telegram_id: null, created_at: new Date(Date.now() - 3_600_000).toISOString(), role: "user", tier: "free", tier_expires_at: null, is_banned: false };
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const out = req.method === "PATCH" ? { id: row.id } : row;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(single ? out : [out]));
  }
  const body = req.url?.includes("/rpc/get_topic_counts") ? COUNTS : [];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(port, "127.0.0.1", () => console.log(`a35 supabase stand-in on ${port}`));
