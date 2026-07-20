import crypto from 'node:crypto';

/**
 * Verify that an incoming request actually came from Slack.
 *
 * Slack signs every request to your webhook URL with an HMAC-SHA256 hash of
 * the request body plus a timestamp, keyed by your app's signing secret.
 * If we don't check this, anyone on the internet who guesses our URL can
 * fire fake commands at us. See:
 *   https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * We also reject anything older than five minutes to defeat replay attacks
 * — an attacker who captures a valid signed request can't just re-send it
 * six minutes later.
 */
export interface VerifyInput {
  signingSecret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  /** Optional injected clock for tests. */
  now?: () => number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

const FIVE_MINUTES_SECONDS = 60 * 5;

export function verifySlackRequest(input: VerifyInput): VerifyResult {
  const { signingSecret, timestampHeader, signatureHeader, rawBody } = input;
  const now = input.now ?? (() => Math.floor(Date.now() / 1000));

  if (!signingSecret) return { ok: false, reason: 'missing_signing_secret' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp_header' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature_header' };

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  // Replay-attack window: reject anything more than 5 minutes off from our clock.
  if (Math.abs(now() - timestamp) > FIVE_MINUTES_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  if (!crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
