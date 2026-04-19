"use client";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circle" | "card" | "rect";
}

export default function Skeleton({ className = "", variant = "text" }: SkeletonProps) {
  const baseClass = "animate-pulse bg-[var(--mp-border)] rounded";
  const variants = {
    text: `${baseClass} h-4 w-full rounded ${className}`,
    circle: `${baseClass} rounded-full ${className}`,
    card: `${baseClass} rounded-2xl ${className}`,
    rect: `${baseClass} rounded-xl ${className}`,
  };
  return <div className={variants[variant]} />;
}

export function SkeletonCard() {
  return (
    <div className="card rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" className="w-12 h-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
  );
}
