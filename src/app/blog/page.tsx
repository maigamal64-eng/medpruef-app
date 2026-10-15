import BlogIndexClient from "./BlogIndexClient";
import { visibleAnswerPages } from "@/lib/answer-pages/registry";

/**
 * /blog index. Server wrapper so the answer-page list (a-answer-pages) reads
 * ANSWER_PAGES_ENABLED on the server; the list is empty while the flag is off.
 */
export default function BlogIndexPage() {
  const answers = visibleAnswerPages().map(({ slug, title, description }) => ({ slug, title, description }));
  return <BlogIndexClient answers={answers} />;
}
