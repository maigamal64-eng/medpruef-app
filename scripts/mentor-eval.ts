/**
 * Entry of the mentor golden-set runner (W2-EVAL). Run through
 * scripts/mentor-eval.mjs, which starts this file with vite-node so the "@/"
 * alias and TypeScript work. See tests/mentor-eval/lib/cli.ts for the flags.
 */
import { main } from "../tests/mentor-eval/lib/cli";

main(process.argv.slice(2), process.env, {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
}).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`mentor-eval: ${String((err as Error)?.stack ?? err)}\n`);
    process.exit(2);
  },
);
