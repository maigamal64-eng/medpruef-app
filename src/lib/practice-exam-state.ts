/** One strict outcome for feedback, summaries and persistence. */
export function gradeSelection(options: readonly { correct: boolean }[], selected: readonly number[]) {
  const picks = new Set(selected);
  const correct = options.flatMap((o, i) => o.correct ? [i] : []);
  const found = correct.filter(i => picks.has(i)).length;
  const wrong = [...picks].filter(i => !correct.includes(i)).length;
  const state = correct.length > 0 && found === correct.length && wrong === 0
    ? 'correct' : found > 0 ? 'partial' : 'wrong';
  return { state, isCorrect: state === 'correct', found, wrong, required: correct.length } as const;
}

export function examSelectionState(required: number, selected: readonly number[] = []) {
  return selected.length === 0 ? 'empty' : selected.length < Math.max(1, required) ? 'partial' : 'complete';
}

export function updateExamSelection(answers: Record<number, number[]>, index: number, selected: number[]) {
  const next = { ...answers };
  if (selected.length) next[index] = selected;
  else delete next[index];
  return next;
}

export function answerShortcut(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code' | 'isComposing'>>, count: number) {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  // Printed Latin letters win on AZERTY/QWERTZ. Other layouts can use the
  // physical key; virtual keyboards without code only use safe characters.
  let index: number | null = null;
  if (/^[a-e]$/i.test(event.key)) index = event.key.toLowerCase().charCodeAt(0) - 97;
  else if (/^[1-5]$/.test(event.key)) index = Number(event.key) - 1;
  else if (/^Key[A-E]$/.test(event.code || '') && event.key.length === 1) index = event.code!.charCodeAt(3) - 65;
  else if (/^(Digit|Numpad)[1-5]$/.test(event.code || '') && event.key.length === 1) index = Number(event.code!.slice(-1)) - 1;
  return index !== null && index < count ? index : null;
}

export function wallClockRemaining(startedAt: number, durationS: number, now: number, previous = durationS) {
  return Math.min(previous, Math.max(0, Math.min(durationS, durationS - Math.floor((now - startedAt) / 1000))));
}

export function createFinaliseGuard() {
  let finished = false;
  return { run(action: () => void) { if (finished) return false; finished = true; action(); return true; }, reset() { finished = false; } };
}
