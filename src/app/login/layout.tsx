import { APP_NOINDEX } from "@/lib/seo/noindex";
import { deKpEnabled } from "@/lib/de-kp";
import { DeKpLoginFlag } from "@/components/de-kp/DeKpLoginFlag";

// a-seo-from-gsc: app surface, kept out of search (see src/lib/seo/noindex.ts).
export const metadata = APP_NOINDEX;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <DeKpLoginFlag on={deKpEnabled()}>{children}</DeKpLoginFlag>;
}
