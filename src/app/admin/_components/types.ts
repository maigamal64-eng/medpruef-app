/**
 * Shared types used across the admin nested-route pages.
 *
 * These mirror the shape of the `/api/stats/admin/*` JSON payloads.
 * Each tab's page.tsx imports the types it needs from here — so the
 * fetch + render code stays single-sourced and can't drift between
 * pages.
 */

export interface OverviewData {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  questionsToday: number;
  questionsThisWeek: number;
  avgAccuracyByTopic: { topic: string; accuracy: number; total: number }[];
  topTopics: { topic: string; accuracy: number; total: number }[];
  weakTopics: { topic: string; accuracy: number; total: number }[];
  peakStudyHours: { hour: number; count: number }[];
  dailyActiveUsers: { date: string; users: number }[];
}

export interface UserRow {
  id: string;
  telegram_id: string | null;
  email: string | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  role: string;
  tier: string;
  status: string;
  created_at: string;
  xp: number;
  streak: number;
  questions_answered: number;
  accuracy: number;
  daily_today: number;
  last_study: string | null;
  last_active: string;
}

export interface QuestionStats {
  totalAll: number;
  active: number;
  inactive: number;
  withMCQ: number;
  withExplanations: number;
  withImages: number;
  mcqPct: number;
  explPct: number;
  imgPct: number;
  byTopic: { topic: string; count: number }[];
}

export interface QuestionRow {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string | null;
  choices: { text: string; correct?: boolean }[] | null;
  image_url: string | null;
  exam_dates: string[] | null;
  tags: string[] | null;
  is_active: boolean;
  anki_note_id: number | null;
  created_at: string;
  question_preview: string;
  choices_count: number;
  has_explanation: boolean;
  has_image: boolean;
}

export interface DuplicateData {
  totalGroups: number;
  totalExtraCopies: number;
  groups: {
    text: string;
    count: number;
    questions: { id: number; topic: string; exam_dates: string[]; anki_note_id: number | null }[];
  }[];
}

export interface ActivityRow {
  id: number;
  user_id: string;
  session_id: string;
  event_type: string;
  page: string | null;
  action: string | null;
  metadata: Record<string, unknown>;
  question_id: number | null;
  topic: string | null;
  duration_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface NewUsersData {
  lastHour: number;
  today: number;
  lastSevenDays: number;
  lastThirtyDays: number;
  total: number;
  recent: Array<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    telegram_username: string | null;
    tier: string | null;
    created_at: string;
  }>;
  generatedAt: string;
}

export interface FeedbackItem {
  id: number;
  user_id: string | null;
  message: string;
  context: Record<string, unknown>;
  status: string;
  admin_note: string | null;
  created_at: string;
}

export interface SuggestionsResponse {
  suggestions: unknown[];
  counts: { pending: number; approved: number; rejected: number; total: number };
}

// Chart palette — recharts Cell fill requires literal colors, not CSS vars.
// Sourced from MPDS tokens: viridian, cta-blue, warning (WCAG-safe amber), error, accent-teal, info.
// Purple + pink round out the 8 slots for topic distribution pie — not yet tokenized.
export const CHART_COLORS = [
  "#007B5F",
  "#003A8C",
  "#D68A3A",
  "#D64545",
  "#00A896",
  "#3A7CA5",
  "#8B5CF6",
  "#EC4899",
];
