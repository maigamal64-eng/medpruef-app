/**
 * SELECT-only SQL guard for the /admin/sql runner.
 *
 * §2.8 of the April 23 admin revamp sprint.
 *
 * Contract:
 *  - Accepts only a single SQL statement.
 *  - Only SELECT (optionally followed by CTEs via WITH … SELECT).
 *  - Blocks any keyword that mutates schema or data.
 *  - Strips trailing semicolon so pg doesn't reject a multi-statement parse.
 *
 * This is deliberately a regex gate, not libpg-query, because libpg-query
 * adds a ~20MB native dep and the attack model here (admin-only access
 * behind requireAdmin + audit log) doesn't justify the bloat. The checks
 * below are conservative: anything ambiguous is rejected.
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "TRUNCATE",
  "VACUUM",
  "COPY",
  "REINDEX",
  "LISTEN",
  "NOTIFY",
  "LOCK",
  "UNLISTEN",
  "REFRESH",
  "CLUSTER",
  "ANALYZE",
  "RESET",
  "SET",
  "DISCARD",
  // EXPLAIN is mostly safe but EXPLAIN ANALYZE / EXPLAIN ALTER aren't —
  // and we don't need EXPLAIN for admin exploration at this tier.
  "EXPLAIN",
  "DO",
  "CALL",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
  "DECLARE",
  "FETCH",
  "MOVE",
  "CLOSE",
  "SECURITY",
];

export interface SqlGuardResult {
  ok: boolean;
  sql?: string;
  error?: string;
}

export function validateSelectOnly(input: string): SqlGuardResult {
  const trimmed = (input || "").trim().replace(/;+\s*$/, "");

  if (!trimmed) {
    return { ok: false, error: "Query is empty" };
  }

  if (trimmed.length > 20_000) {
    return { ok: false, error: "Query exceeds 20,000 characters" };
  }

  // Reject multi-statement: a semicolon anywhere that isn't inside a
  // string literal or identifier quote means "second statement".
  if (containsStatementSeparator(trimmed)) {
    return { ok: false, error: "Only a single SQL statement is allowed" };
  }

  // Must start with SELECT or WITH (for CTEs).
  const head = stripLeadingCommentsAndWhitespace(trimmed);
  if (!/^(SELECT|WITH)\b/i.test(head)) {
    return {
      ok: false,
      error: "Only SELECT (optionally preceded by WITH …) is allowed",
    };
  }

  // Keyword blocklist — scan outside of strings/identifiers.
  const keywordErr = findForbiddenKeyword(trimmed);
  if (keywordErr) {
    return { ok: false, error: keywordErr };
  }

  // pg_*, auth.*, information_schema.*, and views are all fair game —
  // we don't additionally block them. The service-role client can see
  // every table anyway; the SELECT-only gate is the boundary.

  return { ok: true, sql: trimmed };
}

function stripLeadingCommentsAndWhitespace(sql: string): string {
  let rest = sql;
  while (true) {
    const before = rest;
    rest = rest.replace(/^\s+/, "");
    rest = rest.replace(/^--[^\n]*\n?/, "");
    rest = rest.replace(/^\/\*[\s\S]*?\*\//, "");
    if (before === rest) break;
  }
  return rest;
}

function containsStatementSeparator(sql: string): boolean {
  // Walk the string and flag any `;` not inside a string literal or
  // double-quoted identifier. We allow trailing `;` which was already
  // stripped in validateSelectOnly.
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // Single-quoted literal — escape is doubled single-quote.
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < sql.length && sql[i] !== '"') i += 1;
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === ";") {
      return true;
    }
    i += 1;
  }
  return false;
}

function findForbiddenKeyword(sql: string): string | null {
  // Scan outside of strings/identifiers and comments.
  const upper = stripStringsAndComments(sql).toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    // Word-boundary match — \b handles punctuation and whitespace.
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      return `Forbidden keyword: ${kw}`;
    }
  }
  return null;
}

function stripStringsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      out += " ";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "  ";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out += " ";
          i += 1;
          break;
        }
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      // Keep identifier body — blocking "insert" as an identifier would
      // kill legitimate columns. We zero out the quotes but keep chars.
      out += " ";
      i += 1;
      while (i < sql.length && sql[i] !== '"') {
        out += sql[i];
        i += 1;
      }
      out += " ";
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
