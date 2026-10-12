'use client';
import { useFocusMode } from '@/lib/focus-mode';
import FeedbackWidget from '@/components/FeedbackWidget';
/** Focus runs replace floating chrome with their own inline safety status.
 *  The offline status lives in the root StatusRegion (UX-GLOBAL-11); the
 *  widget hides its own launcher on /exam while the form still opens from
 *  the Mehr sheet. */
export default function StudyChrome() {
  const focus = useFocusMode();
  if (focus) return null;
  return <FeedbackWidget />;
}
