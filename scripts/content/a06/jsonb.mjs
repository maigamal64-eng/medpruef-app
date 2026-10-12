// track-A a06: reproduce PostgreSQL jsonb object key order so a reviewed row can
// be hash-bound before it is inserted. jsonb stores object keys sorted by byte
// length first, then bytewise; PostgREST returns them in that stored order, and
// scripts/content/gate/check.mjs reviewHash() hashes the fetched JSON text.
import { reviewHash } from '../gate/check.mjs';

const byteKey = (key) => Buffer.from(key, 'utf8');
export function jsonbOrder(value) {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => {
      const x = byteKey(a), y = byteKey(b);
      return x.length - y.length || Buffer.compare(x, y);
    });
    return Object.fromEntries(keys.map((key) => [key, jsonbOrder(value[key])]));
  }
  return value;
}

// The hash the activation gate will compute for this row once it is stored.
export function insertedReviewHash(row) {
  return reviewHash({ ...row, choices: jsonbOrder(row.choices) });
}
