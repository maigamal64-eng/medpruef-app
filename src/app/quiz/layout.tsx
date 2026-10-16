import { APP_NOINDEX } from "@/lib/seo/noindex";

// a-seo-from-gsc: app surface, kept out of search (see src/lib/seo/noindex.ts).
export const metadata = APP_NOINDEX;

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
