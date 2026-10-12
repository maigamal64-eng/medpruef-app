// Shared TypeScript-AST helpers for the copy lints: only string content counts,
// never comments or identifiers.
import ts from 'typescript';
import { readFileSync } from 'node:fs';

/** Every string-like literal in a TS/TSX file with its text, start line and the nearest property key. */
export function stringLiterals(path, source = readFileSync(path, 'utf8')) {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const lineOf = pos => file.getLineAndCharacterOfPosition(pos).line + 1;
  const keyOf = node => {
    let n = node.parent;
    while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isBinaryExpression(n) || ts.isTemplateSpan(n) || ts.isTemplateExpression(n))) n = n.parent;
    if (n && ts.isPropertyAssignment(n) && n.initializer) {
      const name = n.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    }
    return null;
  };
  // A string sits in German copy when its property key is `de` or it is the
  // first branch of a `lang === 'de' ? ... : ...` style conditional.
  const germanBranch = node => {
    for (let n = node, p = node.parent; p; n = p, p = p.parent) {
      if (ts.isConditionalExpression(p) && p.whenTrue === n) {
        const cond = p.condition.getText(file);
        if (/(?:===?\s*["']de["']|["']de["']\s*===?|^!?\(?\s*(?:de|isDe|isDE|isGerman)\s*\)?$)/.test(cond)) return true;
      }
      if (ts.isPropertyAssignment(p) && p.initializer === n) {
        const name = p.name;
        return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'de';
      }
      if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isFunctionLike(p)) return false;
    }
    return false;
  };
  const push = (node, text) => out.push({ text, line: lineOf(node.getStart(file)), endLine: lineOf(node.getEnd()), key: keyOf(node), german: germanBranch(node) });
  // Developer-only text: console output and thrown errors are not learner copy.
  const developerOnly = node => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isCallExpression(n) && /^(?:console|Sentry)\./.test(n.expression.getText(file))) return true;
      // Machine-readable API error codes returned to callers are not copy.
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'error') return true;
      if (ts.isNewExpression(n) && /Error$/.test(n.expression.getText(file))) return true;
      if (ts.isBlock(n) || ts.isSourceFile(n)) return false;
    }
    return false;
  };
  const visit = node => {
    if (developerOnly(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // import specifiers and module names are not copy
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isExternalModuleReference(node.parent)) push(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      push(node, [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join(' '));
    } else if (ts.isJsxText(node)) {
      if (node.text.trim()) push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}
