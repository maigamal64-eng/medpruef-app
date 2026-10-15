/** vite-node entry of scripts/ai/claude-runner.mjs (launcher). */
import { main } from "./claude-bridge";

main().then(
  (code) => process.exit(code),
  () => {
    process.stderr.write("claude-runner: unexpected failure\n");
    process.exit(2);
  },
);
