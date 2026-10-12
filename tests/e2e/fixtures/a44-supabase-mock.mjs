// a44 smoke only: a local stand-in for the Supabase REST endpoint so the
// server-rendered /gerichtsmedizin page can be shown with active
// Gerichtsmedizin rows without any production contact. Answers the
// get_topic_counts RPC with a fixture count and every other request with [].
//   node tests/e2e/fixtures/a44-supabase-mock.mjs [port] [gmCount]
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 54399);
const gm = Number(process.argv[3] ?? 127);
createServer((req, res) => {
  const body = req.url?.includes('/rpc/get_topic_counts')
    ? [{ topic: 'Gerichtsmedizin', count: gm }, { topic: 'Pharmakologie', count: 322 }]
    : [];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(port, '127.0.0.1', () => console.log(`a44 supabase mock on ${port} (gm=${gm})`));
