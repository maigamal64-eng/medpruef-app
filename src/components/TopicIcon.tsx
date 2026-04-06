"use client";
import {
  Scissors,
  HeartPulse,
  Brain,
  Eye,
  Ear,
  Baby,
  Users,
  Dna,
  MessageCircle,
  Zap,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Scissors,
  HeartPulse,
  Brain,
  Eye,
  Ear,
  Baby,
  Users,
  Dna,
  MessageCircle,
  Zap,
  ClipboardList,
};

interface Props {
  name: string;
  className?: string;
  size?: number;
}

/**
 * Render a Lucide icon by string name. Falls back to ClipboardList for unknown names.
 * Used for topic/specialty icons across the app (replaces emoji-based icons).
 */
export default function TopicIcon({ name, className = "w-5 h-5", size }: Props) {
  const Icon = ICON_MAP[name] || ClipboardList;
  return <Icon className={className} size={size} />;
}
