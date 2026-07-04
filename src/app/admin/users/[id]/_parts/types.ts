/**
 * Shared types for the per-user admin detail page + its API.
 *
 * The server route (`/api/stats/admin/users/[id]`) builds this exact
 * shape; the client page + `_parts/*` components render it. Keeping the
 * contract in one pure type file means the two halves can't drift.
 *
 * Requested by [name] 2026-07-04 ("open a user dedicated page showing
 * everything we have for this user as a timeline with exact activity
 * details, using as much visuals as possible").
 */

export interface UserDetailProfile {
  id: string;
  email: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  photo_url: string | null;
  role: string;
  tier: string;
  is_banned: boolean;
  language_code: string | null;
  active_exam: string | null;
  exam_date: string | null;
  daily_goal: number | null;
  referral_code: string | null;
  referred_by_code: string | null;
  tier_expires_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  last_active_date: string | null;
}

export interface UserDetailGamification {
  total_xp: number;
  level: number;
  rank_name: string | null;
  current_streak: number;
  longest_streak: number;
  total_questions_answered: number;
  total_correct: number;
  daily_questions_today: number;
  last_study_date: string | null;
}

export interface UserDetailStats {
  answersLogged: number; // rows in answer_history (capped fetch)
  answersCorrect: number;
  accuracy: number; // 0-100
  totalTimeMs: number;
  avgTimeMs: number;
  xpFromAnswers: number;
  activeDays: number;
  firstActivity: string | null;
  lastActivity: string | null;
  sessionsCount: number;
  notesCount: number;
  bookmarksCount: number;
  aiChatsCount: number;
  searchesCount: number;
  pageViewsCount: number;
}

export interface HeatmapCell {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  answered: number;
  correct: number;
}

export interface TopicStat {
  topic: string;
  answered: number;
  correct: number;
  accuracy: number; // 0-100
}

export interface ExamStat {
  examType: string;
  label: string;
  answered: number;
  correct: number;
}

export type TimelineTone =
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "neutral"
  | "money";

export type TimelineKind =
  | "answer"
  | "page_view"
  | "search"
  | "bookmark"
  | "ai_chat"
  | "session_start"
  | "session_end"
  | "translation"
  | "feature_use"
  | "note_created"
  | "feedback"
  | "flag"
  | "subscription"
  | "trial"
  | "referral"
  | "payment"
  | "waitlist"
  | "other";

export interface TimelineItem {
  ts: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  tone: TimelineTone;
  correct?: boolean;
  questionId?: number | null;
  topic?: string | null;
  examType?: string | null;
  amountCents?: number | null;
  status?: string | null;
}

export interface AnswerDetail {
  id: string;
  questionId: number;
  stem: string | null; // null when the question was archived/removed
  removed: boolean;
  topic: string | null;
  examType: string | null;
  userAnswer: string | null;
  isCorrect: boolean;
  timeMs: number | null;
  xp: number | null;
  createdAt: string;
}

export interface SessionDetail {
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  platform: string | null;
  browser: string | null;
  timezone: string | null;
  language: string | null;
  screen: string | null;
  examSource: string | null;
  pagesVisited: string[];
}

export interface NoteDetail {
  id: string;
  title: string | null;
  topic: string | null;
  examType: string | null;
  visibility: string | null;
  isActive: boolean;
  sourceType: string | null;
  createdAt: string;
}

export interface FeedbackDetail {
  id: number;
  message: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

export interface FlagDetail {
  id: number;
  questionId: number | null;
  type: string;
  reason: string | null;
  details: string | null;
  status: string;
  createdAt: string;
}

export interface SubscriptionDetail {
  tier: string | null;
  status: string | null;
  provider: string | null;
  method: string | null;
  amountCents: number | null;
  currency: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface UserMoney {
  isPayer: boolean;
  paidTotalCents: number;
  currency: string;
  subscriptions: SubscriptionDetail[];
  trial: { startedAt: string; expiresAt: string | null; active: boolean } | null;
  referralsMade: number;
  referralsQualified: number;
  referredByCode: string | null;
}

export interface UserDetail {
  profile: UserDetailProfile;
  gamification: UserDetailGamification | null;
  stats: UserDetailStats;
  heatmap: HeatmapCell[];
  trend: TrendPoint[];
  topics: TopicStat[];
  exams: ExamStat[];
  timeline: TimelineItem[];
  timelineTotal: number;
  answers: AnswerDetail[];
  answersTotal: number;
  sessions: SessionDetail[];
  notes: NoteDetail[];
  feedback: FeedbackDetail[];
  flags: FlagDetail[];
  money: UserMoney;
  generatedAt: string;
}
