import type { MCQOption } from "@/lib/mcq";

export type { MCQOption };

export interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: MCQOption[];
  n_correct?: number;
  image_url?: string;
  tags?: string[];
  ai_explanation?: string;
}

export interface UserSession {
  id: string;
  telegram_id?: number;
  email?: string;
  first_name: string;
  last_name?: string;
  role?: string;
  tier?: string;
  xp_total: number;
  streak_count: number;
  daily_goal: number;
}

export interface Gamification {
  total_xp: number;
  current_streak: number;
  total_questions_answered: number;
  total_correct: number;
  daily_questions_today: number;
}

export type Lang = "de" | "en";
