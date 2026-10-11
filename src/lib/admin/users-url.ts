export function readUsersUrl(params: URLSearchParams) {
  const pageValue = Number(params.get("page"));
  const tier = params.get("tier");
  const auth = params.get("auth");
  const sort = params.get("sort");
  const columns = ["name", "auth", "tier", "status", "xp", "streak", "questions_answered", "accuracy", "last_active", "created_at"];
  const q = params.get("q")?.trim() ?? "";
  return {
    query: q.length >= 2 ? q : "",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    tier: ["free", "pro", "admin"].includes(tier ?? "") ? tier! : "all",
    auth: ["email", "telegram"].includes(auth ?? "") ? auth! : "all",
    sort: { col: columns.includes(sort ?? "") ? sort! : "last_active", asc: params.get("order") === "asc" },
  };
}
