#!/usr/bin/env node

/**
 * test_sentry.mjs — Standalone Sentry ingestion verifier.
 *
 * Posts a synthetic error event directly to Sentry's public ingest
 * endpoint using the project DSN. Proves the Sentry project is alive
 * and receiving events WITHOUT waiting for an organic app crash or
 * deploying debug code to production.
 *
 * Context: On 2026-04-21 we discovered that Sentry had been wired for
 * 5+ days but no events were ingesting because instrumentation.ts was
 * missing (SDK 10 + App Router convention). After fixing that, we need
 * a fast, repeatable way to verify ingestion works — so this script.
 *
 * Usage:
 *   node scripts/test_sentry.mjs
 *   # or with a custom message:
 *   node scripts/test_sentry.mjs "My test message"
 *
 * What to expect:
 *   • Exit 0 and a Sentry event_id on success
 *   • A matching event visible at
 *     https://medpruf.sentry.io/issues/ within ~30 seconds
 *
 * Security: the DSN is public-safe (it's baked into client bundles)
 * and does not grant write access to project settings — only the
 * ability to ingest events. Committing this script is fine.
 */

// MedPrüf Sentry DSN (same as sentry.client.config.ts). Public-safe.
const DSN =
  "https://user-edc7605a@example.com/0";

// ------------------------------------------------------------------
// DSN → ingest URL + auth header (Sentry uses a custom envelope API)
// ------------------------------------------------------------------
function parseDsn(dsn) {
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\//, "");
  const publicKey = url.username;
  const host = url.host;
  const protocol = url.protocol;
  return {
    publicKey,
    host,
    protocol,
    projectId,
    envelopeUrl: `${protocol}//${host}/api/${projectId}/envelope/`,
  };
}

async function sendTestEvent(message) {
  const { publicKey, envelopeUrl } = parseDsn(DSN);
  const eventId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

  const timestamp = new Date().toISOString();

  // Sentry envelope format: 3 newline-separated JSON lines.
  //   1. envelope header (event_id, sent_at, sdk)
  //   2. item header (type=event, content_type, length)
  //   3. the actual event payload
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: timestamp,
    sdk: { name: "medpruef.test-script", version: "1.0.0" },
  });

  const event = {
    event_id: eventId,
    timestamp,
    platform: "node",
    level: "error",
    logger: "test_sentry.mjs",
    server_name: "medpruef-ci",
    environment: "test-script",
    release: process.env.VERCEL_GIT_COMMIT_SHA || "dev-local",
    message: {
      formatted: message || "[test_sentry.mjs] Sentry ingestion smoke test",
    },
    exception: {
      values: [
        {
          type: "SentryTestError",
          value:
            message ||
            "[test_sentry.mjs] Sentry ingestion smoke test — safe to ignore",
          stacktrace: {
            frames: [
              {
                filename: "scripts/test_sentry.mjs",
                function: "sendTestEvent",
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    tags: {
      purpose: "ingestion-verification",
      origin: "cli",
    },
    extra: {
      triggered_at: timestamp,
      hostname: process.env.HOSTNAME || "unknown",
    },
  };

  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length: Buffer.byteLength(JSON.stringify(event)),
  });

  const envelope =
    envelopeHeader + "\n" + itemHeader + "\n" + JSON.stringify(event);

  const authHeader =
    `Sentry sentry_version=7, sentry_client=medpruef-test/1.0, ` +
    `sentry_key=${publicKey}`;

  const res = await fetch(envelopeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": authHeader,
    },
    body: envelope,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `Sentry ingest rejected event: HTTP ${res.status} ${res.statusText}\n${text}`
    );
  }

  return { eventId, status: res.status };
}

// ------------------------------------------------------------------
// CLI entry
// ------------------------------------------------------------------
const customMessage = process.argv.slice(2).join(" ") || null;

sendTestEvent(customMessage)
  .then(({ eventId, status }) => {
    console.log("Sentry ingest OK");
    console.log("  status   :", status);
    console.log("  event_id :", eventId);
    console.log(
      "  check    : https://medpruf.sentry.io/issues/?query=" +
        encodeURIComponent(`event.id:${eventId}`)
    );
    console.log(
      "  note     : event usually appears in the UI within ~30 seconds"
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sentry ingest FAILED:", err.message);
    console.error(
      "  → verify the DSN, firewall/proxy rules, or network connectivity"
    );
    process.exit(1);
  });
