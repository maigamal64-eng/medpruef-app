"use client";

import {
  BarChart3, Brain, CalendarDays, CreditCard, Crown, FileText, Gift, GraduationCap, History,
  Home, Layers, Map, MessageSquare, Search, Settings, Sparkles, TrendingUp, XCircle,
} from "lucide-react";
import type { DestinationKey } from "@/lib/nav-destinations";

/** One Lucide icon per destination, one stroke weight (UX-GLOBAL-29). */
const ICONS: Record<DestinationKey, typeof Home> = {
  home: Home,
  practice: FileText,
  library: Layers,
  exam: GraduationCap,
  mistakes: XCircle,
  mentor: Brain,
  "study-plan": CalendarDays,
  curriculum: Map,
  progress: TrendingUp,
  stats: BarChart3,
  history: History,
  settings: Settings,
  billing: CreditCard,
  pricing: Crown,
  changelog: Sparkles,
  referrals: Gift,
  feedback: MessageSquare,
  search: Search,
};

export function DestinationIcon({ name, className = "w-5 h-5" }: { name: DestinationKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden strokeWidth={2} />;
}
