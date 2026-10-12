import { safeStorage } from '@/lib/safe-storage';
export function studyShortcutsEnabled() { return safeStorage.getItem('medpruef_study_shortcuts') !== 'off'; }
export function setStudyShortcutsEnabled(enabled: boolean) { safeStorage.setItem('medpruef_study_shortcuts', enabled ? 'on' : 'off'); }
