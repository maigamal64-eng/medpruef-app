import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const POLICY = fileURLToPath(new URL('./claims-policy.json', import.meta.url));
export const hash = text => createHash('sha256').update(text).digest('hex');
export const inScope = path => /^(src\/app\/|src\/lib\/i18n[^/]*\.ts$|blog\/|marketing\/|comms\/)/.test(path)
  && /\.(?:ts|tsx|js|jsx|mjs|md|mdx|html|txt|json)$/.test(path)
  && !/\.(?:test|spec)\./.test(path);

// Git supplies the inventory, so ignored drafts and other worktrees cannot enter the scan.
export function trackedFiles(repo = ROOT) {
  return execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter(inScope).sort();
}

export function sourceLines(repo = ROOT) {
  const root = realpathSync(repo);
  return trackedFiles(repo).flatMap(path => {
    const full = resolve(root, path);
    if (!full.startsWith(root + sep)) throw new Error('Path outside repository');
    let component = root;
    for (const part of path.split('/')) {
      component = resolve(component, part);
      if (lstatSync(component).isSymbolicLink()) throw new Error('Tracked source symlink is outside scan scope');
    }
    if (!realpathSync(full).startsWith(root + sep)) throw new Error('Canonical path outside repository');
    return readFileSync(full, 'utf8').split(/\r?\n/).map((text, i) => ({ path, line: i + 1, text }));
  });
}

// A soft newline is whitespace in Markdown and JSX. Blank lines, file boundaries
// and nonconsecutive source locations delimit blocks; retain physical offsets.
export function logicalBlocks(lines) {
  const blocks = [];
  let block;
  for (const source of lines) {
    if (!source.text.trim()) { block = undefined; continue; }
    const previous = block?.sources.at(-1);
    if (!previous || previous.path !== source.path || previous.line + 1 !== source.line) {
      block = { path: source.path, text: '', sources: [] };
      blocks.push(block);
    }
    if (block.sources.length) block.text += '\n';
    block.sources.push({ ...source, offset: block.text.length });
    block.text += source.text;
  }
  return blocks;
}

export function sourceLocation(block, start, length) {
  const sources = block.sources.filter(s => s.offset < start + length && s.offset + s.text.length > start);
  return { path: block.path, line: sources[0].line,
    sha256: hash(sources.map(s => s.text).join('\n').trim()) };
}

export function argumentsFor(argv, allowed) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!Object.hasOwn(allowed, key)) throw new Error(`Unknown option: ${key}`);
    if (allowed[key] === 'flag') options[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value: ${key}`);
      options[key] = argv[++i];
    }
  }
  return options;
}

export function isMain(metaUrl) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
