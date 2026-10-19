import BlogIndexClient from "./BlogIndexClient";
import { visibleAnswerPages } from "@/lib/answer-pages/registry";
import type { AnswerPage } from "@/lib/answer-pages/types";
import { ANSWER_UI } from "@/lib/answer-pages/copy";

/**
 * /blog index. Server wrapper so the answer-page list (a-answer-pages) reads
 * ANSWER_PAGES_ENABLED on the server; the list is empty while the flag is off.
 */
export default function BlogIndexPage() {
  const teaser = ({ slug, title, description }: AnswerPage) => ({ slug, title, description });
  const visible = visibleAnswerPages();
  // a-seo-articles-1019: guides get their own section above the short answers.
  return <BlogIndexClient guidesHeading={{ de: ANSWER_UI.de.guidesHeading, en: ANSWER_UI.en.guidesHeading }} guides={visible.filter((p) => p.article).map(teaser)} answers={visible.filter((p) => !p.article).map(teaser)} />;
}
