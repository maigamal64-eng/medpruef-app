/**
 * Shared keyboard-guard helpers — used by every global `window`/`document`
 * keydown listener to bail out when the user is typing in an input,
 * textarea, contentEditable element, or anywhere inside a dialog.
 *
 * Why this module exists (review-2026-04-26-A1):
 *
 * Multiple global keydown handlers across the app used the narrow guard
 *
 *     if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
 *
 * That misses three real cases:
 *   1. `contentEditable` elements (rich-text widgets, future editors).
 *   2. Inputs rendered inside a portal where the event target is the
 *      portal wrapper div, not the input itself.
 *   3. ANY key inside a `[role="dialog"]` overlay — even a button or
 *      a div — should not fire global shortcuts that close the dialog
 *      or mutate state behind it.
 *
 * Concrete bug closed: typing the second character into the
 * FeedbackWidget textarea, the Flag-a-question modal, or the
 * "Ich habe keine Krypto" form fired the QuestionCard A-E answer
 * shortcut OR the quiz "n=next" shortcut, which mutated state and
 * closed the surrounding dialog.
 *
 * Use either:
 *   - `isTypingTarget(e.target)` for narrow input/textarea/contentEditable check
 *   - `isInDialog(e.target)` for "any key inside a dialog overlay"
 *   - `shouldIgnoreGlobalKey(e)` for the canonical combined check most
 *     listeners want.
 */

/**
 * Walks up from `target` until it finds an element matching `predicate`,
 * or returns null at the document root. Safe for portaled DOM where
 * `e.target` may be a slot div rather than the focused input.
 */
function closestMatching(
  target: EventTarget | null,
  predicate: (el: Element) => boolean,
): Element | null {
  let el = target as Element | null;
  while (el && el.nodeType === 1) {
    if (predicate(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Returns true when the event target is itself or contains a typing-
 * eligible element (input/textarea/select/contentEditable).
 *
 * Looks UP the DOM tree so a portaled input whose event target is its
 * wrapper still resolves correctly. Also handles Radix-style slot divs.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  // Direct match.
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (el.isContentEditable) return true;
  // Walk up — covers portaled inputs whose target is the slot wrapper.
  const ancestor = closestMatching(el, (e) => {
    const t = e.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
    if ((e as HTMLElement).isContentEditable) return true;
    if (e.getAttribute?.("role") === "textbox") return true;
    return false;
  });
  return ancestor !== null;
}

/**
 * Returns true when the event target is inside any open dialog/modal
 * overlay. Matches `[role="dialog"]`, `[role="alertdialog"]`, and the
 * MPDS `.mp-dialog__overlay` class for safety.
 *
 * Use this BEFORE handling any global shortcut that mutates state
 * behind a dialog — the user's intent is the dialog content, not the
 * page beneath it.
 */
export function isInDialog(target: EventTarget | null): boolean {
  if (!target) return false;
  return (
    closestMatching(
      target,
      (el) =>
        el.getAttribute?.("role") === "dialog" ||
        el.getAttribute?.("role") === "alertdialog" ||
        el.classList?.contains("mp-dialog__overlay") ||
        el.classList?.contains("mp-bottom-sheet"),
    ) !== null
  );
}

/**
 * Canonical "should this global keydown listener bail out?" check.
 * Returns true when the event is in a typing context OR inside a
 * dialog (regardless of focus target — even a Tab landing on a button
 * inside a dialog should not fire global shortcuts).
 */
export function shouldIgnoreGlobalKey(e: KeyboardEvent): boolean {
  return isTypingTarget(e.target) || isInDialog(e.target);
}
