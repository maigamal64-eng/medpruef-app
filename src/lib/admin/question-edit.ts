export function changedQuestionFields(before: Record<string, unknown>, proposed: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(proposed).filter(([key, value]) => {
    // Empty explanation is equivalent to the editor's null-to-empty display.
    const old = key === "explanation" ? before[key] ?? "" : before[key];
    return JSON.stringify(old) !== JSON.stringify(value);
  }));
}
