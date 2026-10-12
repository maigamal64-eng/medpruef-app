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
createServer((req, res) => {
  const body = req.url?.includes("/rpc/get_topic_counts") ? COUNTS : [];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(port, "127.0.0.1", () => console.log(`a35 supabase stand-in on ${port}`));
