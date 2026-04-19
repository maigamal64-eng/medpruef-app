"use client";

import { type ReactNode } from "react";

interface StatsCardProps {
  icon: ReactNode;
  value: string | number;
  label: string;
  color: string;
  delay?: number;
}

export default function StatsCard({ icon, value, label, color, delay = 0 }: StatsCardProps) {
  return (
    <div
      className="card rounded-2xl p-5 text-center"
    >
      <div className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/10 flex items-center justify-center mx-auto mb-2">{icon}</div>
      <div className={`text-2xl font-black font-mono text-[var(--mp-fg)]`}>{value}</div>
      <div className="text-xs text-[var(--mp-fg-subtle)] font-medium mt-1">{label}</div>
    </div>
  );
}
