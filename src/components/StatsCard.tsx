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
      className="card p-4 text-center"
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-xs text-[#A0AEC0] mt-0.5">{label}</div>
    </div>
  );
}
