'use client';
import { usePathname } from 'next/navigation';
import { useFocusMode } from '@/lib/focus-mode';
import FeedbackWidget from '@/components/FeedbackWidget';
import OfflineIndicator from '@/components/OfflineIndicator';
/** Focus runs replace floating chrome with their own inline safety status. */
export default function StudyChrome() {
  const focus = useFocusMode();
  const path = usePathname();
  if (focus) return null;
  return <>{path !== '/exam' && <FeedbackWidget />}<OfflineIndicator /></>;
}
