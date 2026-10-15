/**
 * Launch gate for the answer pages (a-answer-pages, marketing lever M4).
 * Server env ANSWER_PAGES_ENABLED: only the literal "true" turns the pages,
 * their sitemap entries, the llms.txt section and the internal links on.
 * Absent or any other value: every answer URL is a 404 and nothing links to
 * one. Sitemap, llms.txt and the static /blog index are built at deploy
 * time, so a flip needs a redeploy (as every Vercel env change does).
 */
export function answerPagesEnabled(value: string | undefined = process.env.ANSWER_PAGES_ENABLED): boolean {
  return value === "true";
}
