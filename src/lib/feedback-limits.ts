/** Limits for the public, auth-optional POST /api/feedback (also used by the
 *  public guidance report form). Survey and widget messages stay well below them. */
export const FEEDBACK_MAX_BODY_BYTES = 8 * 1024
export const FEEDBACK_MAX_MESSAGE_CHARS = 4000
export const FEEDBACK_MAX_CONTEXT_CHARS = 4000
export const FEEDBACK_MAX_CONTEXT_KEYS = 40
export const FEEDBACK_IP_LIMIT = { limit: 10, windowMs: 10 * 60_000 }
export const FEEDBACK_USER_LIMIT = { limit: 10, windowMs: 10 * 60_000 }

