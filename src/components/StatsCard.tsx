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
      className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center card-hover animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-xs text-[#879391] mt-0.5">{label}</div>
    </div>
  );
}
