import { describe, expect, it } from "vitest";
import { columnExpr, logicSql, operatorSql, restToSql, selectList, splitTop, statusForSqlState, valueLiteral, MissingFunctionError, type RestContext } from "../../replay/whop/pgrest";

// a-flip-kassa-replay: the PostgREST stand-in must translate exactly what
// supabase-js sends, and refuse what it does not understand.
const ctx: RestContext = {
  primaryKey: (t) => (t === "processed_webhook_events" ? ["provider", "event_id"] : ["id"]),
  fn: (name, argNames) => {
    if (name === "grant_whop_paid_subscription") return { args: [{ name: "p_user_id", type: "uuid" }, { name: "p_months", type: "integer" }, { name: "p_meta", type: "jsonb" }, { name: "p_ids", type: "text[]" }], returnsSet: true, returns: "composite" };
    throw new MissingFunctionError(`Could not find the function public.${name}(${argNames.join(", ")}) in the schema cache`);
  },
};
const req = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  restToSql(method, new URL(`http://x/rest/v1/${path}`), new Headers(headers), body, ctx);

describe("pgrest filters", () => {
  it("translates the operators supabase-js emits", () => {
    expect(operatorSql("c", "eq.pay_1")).toBe("c = 'pay_1'");
    expect(operatorSql("c", "is.null")).toBe("c IS NULL");
    expect(operatorSql("c", "not.is.null")).toBe("NOT (c IS NULL)");
    expect(operatorSql("c", 'in.("a","b,c")')).toBe("c IN ('a', 'b,c')");
    expect(operatorSql("c", 'cs.[{"payment_id":"pay_1"}]')).toBe(`c @> '[{"payment_id":"pay_1"}]'`);
    expect(operatorSql("c", "ilike.*x*")).toBe("c ILIKE '%x%'");
    expect(operatorSql("c", "eq.o'brien")).toBe("c = 'o''brien'");
  });

  it("refuses an operator it does not know", () => {
    expect(() => operatorSql("c", "fts.x")).toThrow(/unsupported operator/);
  });

  it("handles or/and groups and json paths", () => {
    expect(logicSql("or", "(status.eq.active,and(tier.eq.pro,expires_at.gt.2026-01-01))", "t")).toBe(`(t."status" = 'active' OR (t."tier" = 'pro' AND t."expires_at" > '2026-01-01'))`);
    expect(columnExpr("metadata->>tier", "t")).toEqual({ sql: `t."metadata"->>'tier'`, name: "tier" });
    expect(splitTop('a,b(c,d),"e,f"')).toEqual(["a", "b(c,d)", '"e,f"']);
  });

  it("refuses embedded resources in a select", () => {
    expect(() => selectList("id,users(email)", "t")).toThrow(/embedded resource/);
    expect(selectList("id,alias:tier", "t")).toBe(`t."id" AS "id", t."tier" AS "alias"`);
  });
});

describe("pgrest statements", () => {
  it("GET with filters, order, limit and an exact count", () => {
    const p = req("GET", "subscriptions?select=id,tier&user_id=eq.u1&status=in.(active,trialing)&order=expires_at.desc.nullslast&limit=1", { prefer: "count=exact" });
    expect(p.sql).toContain(`WHERE __t."user_id" = 'u1' AND __t."status" IN ('active', 'trialing')`);
    expect(p.sql).toContain(`ORDER BY __t."expires_at" DESC NULLS LAST LIMIT 1`);
    expect(p.sql).toContain("SELECT count(*)::text FROM public.\"subscriptions\" __t WHERE");
    expect(p.count).toBe(true);
  });

  it("single() asks for one object", () => {
    expect(req("GET", "users?id=eq.u1", { accept: "application/vnd.pgrst.object+json" }).single).toBe(true);
  });

  it("insert lists only the given columns (defaults apply) and upsert targets the key", () => {
    const ins = req("POST", "processed_webhook_events?select=event_id", { prefer: "return=representation" }, { provider: "whop", event_id: "pay_1" });
    expect(ins.sql).toContain(`INSERT INTO public."processed_webhook_events" AS __t ("provider", "event_id") SELECT __src."provider", __src."event_id"`);
    expect(ins.returnRows).toBe(true);
    const up = req("POST", "processed_webhook_events", { prefer: "resolution=ignore-duplicates" }, [{ provider: "whop", event_id: "pay_1" }]);
    expect(up.sql).toContain(`ON CONFLICT ("provider", "event_id") DO NOTHING`);
    expect(up.returnRows).toBe(false);
  });

  it("update and delete are filtered on the target alias", () => {
    expect(req("PATCH", "subscriptions?id=eq.s1", {}, { status: "refunded" }).sql).toContain(`SET "status" = __src."status" FROM (SELECT * FROM json_populate_record(NULL::public."subscriptions"`);
    expect(req("DELETE", "processed_webhook_events?provider=eq.whop&event_id=eq.pay_1").sql).toContain(`DELETE FROM public."processed_webhook_events" AS __t WHERE __t."provider" = 'whop' AND __t."event_id" = 'pay_1'`);
  });

  it("rpc casts named arguments to the function's types", () => {
    const p = req("POST", "rpc/grant_whop_paid_subscription", {}, { p_user_id: "u1", p_months: 3, p_meta: { a: 1 }, p_ids: ["x"] });
    expect(p.sql).toBe(`SELECT coalesce(jsonb_agg(to_jsonb(__r)), '[]'::jsonb)::text FROM public."grant_whop_paid_subscription"("p_user_id" => 'u1'::uuid, "p_months" => '3'::integer, "p_meta" => '{"a":1}'::jsonb, "p_ids" => ARRAY(SELECT json_array_elements_text('["x"]'::json))::text[]) __r`);
  });

  it("a missing function surfaces as MissingFunctionError (served as PGRST202)", () => {
    expect(() => req("POST", "rpc/grant_whop_paid_subscription_pinned", {}, { p_user_id: "u1" })).toThrow(MissingFunctionError);
  });

  it("a top-level value is literal; quotes delimit only inside lists and logic trees", () => {
    expect(operatorSql("c", 'eq."x"')).toBe(`c = '"x"'`);
    expect(logicSql("or", '(a.eq."x,y",b.is.null)', null)).toBe(`("a" = 'x,y' OR "b" IS NULL)`);
  });

  it("refuses what it cannot answer like PostgREST", () => {
    expect(() => req("PATCH", "subscriptions", {}, { status: "x" })).toThrow(/without a filter/);
    expect(() => req("DELETE", "subscriptions")).toThrow(/without a filter/);
    expect(() => req("GET", "rpc/grant_whop_paid_subscription")).toThrow(/rpc over GET/);
    expect(() => req("POST", "subscriptions", { prefer: "count=exact" }, { id: "s" })).toThrow(/count on a write/);
    expect(() => req("POST", "subscriptions", { prefer: "missing=default" }, [{ id: "s" }])).toThrow(/missing=default/);
  });

  it("a single() write rolls back unless exactly one row is affected", () => {
    const p = req("PATCH", "subscriptions?id=eq.s1", { accept: "application/vnd.pgrst.object+json", prefer: "return=representation" }, { status: "refunded" });
    expect(p.sql).toContain("CASE WHEN (SELECT count(*) FROM __w) = 1 THEN");
    expect(p.sql).toContain("ELSE (1 / (SELECT count(*) - count(*) FROM __w))::text END");
  });

  it("values and status codes", () => {
    expect(valueLiteral(null, "uuid")).toBe("NULL::uuid");
    expect(statusForSqlState("23505")).toBe(409);
    expect(statusForSqlState("57014")).toBe(503);
    expect(statusForSqlState("22P02")).toBe(400);
  });
});
