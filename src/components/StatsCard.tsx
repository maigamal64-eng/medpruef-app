"use client";

interface StatsCardProps {
  icon: string;
  value: string | number;
  label: string;
  color: string;
  delay?: number;
}

export default function StatsCard({ icon, value, label, color, delay = 0 }: StatsCardProps) {
  return (
    <div
      className="bg-[#1E293B]/60 border border-[#334155]/50 rounded-xl p-4 text-center card-hover animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-[#94A3B8] mt-0.5">{label}</div>
    </div>
  );
}
