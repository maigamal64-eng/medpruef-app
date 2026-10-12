import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSION_KEYS, canAuthorizeAdminRequest } from "@/lib/admin/permissions";

// a15 review P1: the admin route map is deny-by-default, so a new admin
// endpoint without an entry 403s for every admin. Every handler under the
// admin API trees must be reachable by an owner (all permissions).
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
  });
}

// Pre-existing handlers that stay denied on purpose until an owner
// classifies them. Do not add new entries here; map the route instead.
const KNOWN_DENIED = new Set(["DELETE /api/stats/admin/users"]);

describe("admin route map ratchet", () => {
  const files = [...routes("src/app/api/admin"), ...routes("src/app/api/stats/admin")];
  const owner = { roles: [{ key: "owner", name: "Owner" }], permissions: [...ADMIN_PERMISSION_KEYS] };
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/export\s+(?:const|async\s+function)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
    const path = "/" + file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000001");
    for (const method of methods) {
      if (KNOWN_DENIED.has(`${method} ${path}`)) continue;
      it(`${method} ${path} is classified`, () => {
        expect(canAuthorizeAdminRequest("admin", owner, path, method)).toBe(true);
      });
    }
  }
});
