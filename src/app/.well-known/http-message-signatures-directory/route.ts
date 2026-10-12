/**
 * GET /.well-known/http-message-signatures-directory
 *
 * Web Bot Auth key directory (Cloudflare spec).
 * https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
 *
 * Publishes MedPrüf's Ed25519 public key as a JWKS so a receiving site
 * (or a bot-auth-aware crawler) can verify a signed request that claims
 * to come from medpruf.com, per RFC 9421 (HTTP Message Signatures) +
 * the Web Bot Auth directory convention.
 *
 * Content-Type is the spec's own media type,
 * `application/http-message-signatures-directory+json` — not a generic
 * `application/json` fallback, since we confirmed the exact type from
 * Cloudflare's own docs rather than guessing.
 *
 * kty/crv/x are the only fields Cloudflare's own verifier reads; kid,
 * use, and alg are included anyway per this task's explicit ask (a kid
 * lets a future multi-key rotation disambiguate, use/alg are the
 * JOSE-correct values for an Ed25519 signing key) and are harmless
 * extras per the spec ("MAY include other standard JWK parameters").
 *
 * IMPORTANT (read before assuming more than this endpoint claims):
 * this route ONLY publishes the public key. MedPrüf does NOT yet SIGN
 * its own outbound bot/agent requests with the matching private key
 * (no Signature-Agent / Signature-Input headers are attached anywhere
 * in this codebase as of this change). Publishing this directory is a
 * valid, honest "readiness declaration" step per the spec (a receiver
 * can verify a signature IF one is ever presented), but it does not by
 * itself mean MedPrüf identifies itself as a bot/agent to other sites.
 * The private key is held by the orchestrator outside this repo (see
 * this task's RETURN report) precisely so it is available WHEN
 * outbound signing is built, without ever having lived in git history.
 */
export const dynamic = "force-static";
export const maxDuration = 30;

const JWKS = {
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      x: "eVG2LVeN2VRduPEOQT8jyWBSoeIeTX3V1Xn9Z_-1P1s",
      kid: "vihKdCSpEiKSDM_8ixXUH5YmIqmU-3h4v_YJ8RZvFUU",
      use: "sig",
      alg: "EdDSA",
    },
  ],
};

export async function GET() {
  return new Response(JSON.stringify(JWKS, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/http-message-signatures-directory+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
