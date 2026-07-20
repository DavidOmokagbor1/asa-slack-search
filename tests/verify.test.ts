import crypto from 'node:crypto';
import { verifySlackRequest } from '../lib/verify.js';

/**
 * Signature verification is security-critical: get this wrong and any
 * attacker on the internet can trigger our slash command. Tests here
 * cover the happy path plus every failure mode the verifier can hit.
 */

const SECRET = 'test-signing-secret-do-not-use-in-prod';

function signRequest(body: string, timestamp: number, secret = SECRET): string {
  const baseString = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(baseString)
    .digest('hex');
  return `v0=${hash}`;
}

describe('verifySlackRequest', () => {
  const fixedNow = 1_700_000_000;
  const now = () => fixedNow;

  it('accepts a correctly-signed request within the replay window', () => {
    const body = 'command=%2Fasa&text=Yoruba+textiles';
    const timestamp = fixedNow;
    const signature = signRequest(body, timestamp);

    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(timestamp),
      signatureHeader: signature,
      rawBody: body,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a request with a tampered body', () => {
    const originalBody = 'command=%2Fasa&text=Yoruba+textiles';
    const tamperedBody = 'command=%2Fasa&text=evil';
    const timestamp = fixedNow;
    const signature = signRequest(originalBody, timestamp);

    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(timestamp),
      signatureHeader: signature,
      rawBody: tamperedBody,
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a request signed with the wrong secret', () => {
    const body = 'command=%2Fasa&text=hello';
    const timestamp = fixedNow;
    const signature = signRequest(body, timestamp, 'wrong-secret');

    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(timestamp),
      signatureHeader: signature,
      rawBody: body,
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a replayed request more than 5 minutes old', () => {
    const body = 'command=%2Fasa&text=hello';
    const timestamp = fixedNow - 60 * 6; // 6 minutes ago
    const signature = signRequest(body, timestamp);

    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(timestamp),
      signatureHeader: signature,
      rawBody: body,
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a request with a future timestamp beyond the window', () => {
    const body = 'command=%2Fasa&text=hello';
    const timestamp = fixedNow + 60 * 10; // 10 minutes in the future
    const signature = signRequest(body, timestamp);

    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(timestamp),
      signatureHeader: signature,
      rawBody: body,
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a request missing the timestamp header', () => {
    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: undefined,
      signatureHeader: 'v0=abc',
      rawBody: 'body',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_timestamp_header' });
  });

  it('rejects a request missing the signature header', () => {
    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: String(fixedNow),
      signatureHeader: undefined,
      rawBody: 'body',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_signature_header' });
  });

  it('rejects a non-numeric timestamp', () => {
    const result = verifySlackRequest({
      signingSecret: SECRET,
      timestampHeader: 'not-a-number',
      signatureHeader: 'v0=abc',
      rawBody: 'body',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_timestamp' });
  });
});
