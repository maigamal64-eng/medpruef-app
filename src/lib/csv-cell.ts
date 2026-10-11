/** Quote CSV cells and neutralize spreadsheet formulas, including leading whitespace. */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);
  if (/^\s*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  const escaped = text.replace(/"/g, '\"\"');
  return /[,"\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}
