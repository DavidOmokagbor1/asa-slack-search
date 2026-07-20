import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifySlackRequest } from '../../lib/verify.js';
import { searchArchive, AsaClientError } from '../../lib/asa.js';
import {
  resultsBlock,
  emptyResultsBlock,
  errorBlock,
  type SlackResponse,
} from '../../lib/blocks.js';

/**
 * Slack slash-command endpoint.
 *
 * Slack fires a POST to this URL every time a user types `/asa <query>`.
 * The flow is:
 *
 *   1. Read the raw body (we need the exact bytes for HMAC verification).
 *   2. Verify Slack's HMAC signature — reject if it's missing, stale, or wrong.
 *   3. Parse the form-encoded command payload.
 *   4. Call Àṣà Archive's /api/search with the user's query.
 *   5. Format the results as Slack Block Kit and return them.
 *
 * We do the whole flow synchronously and respond within Slack's 3-second
 * window. If the archive gets slow enough that this becomes tight, the
 * fix is to ack immediately with { text: 'Searching…' } and post the
 * real answer to Slack's `response_url` in a follow-up request.
 */

export const config = {
  api: {
    // We need the raw body bytes to compute the HMAC. Vercel's default
    // JSON body parser would consume the stream and change the bytes we hash.
    bodyParser: false,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const rawBody = await readRawBody(req);

  const verification = verifySlackRequest({
    signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
    timestampHeader: firstHeader(req.headers['x-slack-request-timestamp']),
    signatureHeader: firstHeader(req.headers['x-slack-signature']),
    rawBody,
  });
  if (!verification.ok) {
    // Deliberately return 401 with no body — don't hand attackers hints.
    console.warn('slack_verify_failed', { reason: verification.reason });
    res.status(401).end();
    return;
  }

  const form = new URLSearchParams(rawBody);
  const query = (form.get('text') ?? '').trim();
  const commandName = form.get('command') ?? '/asa';
  const userId = form.get('user_id') ?? 'unknown';

  console.log('slack_command_received', {
    command: commandName,
    user_id: userId,
    query_length: query.length,
  });

  if (!query) {
    res.status(200).json({
      response_type: 'ephemeral',
      text: `Usage: ${commandName} <search terms>`,
    } satisfies SlackResponse);
    return;
  }

  try {
    const results = await searchArchive({
      archiveBaseUrl: requireEnv('ASA_ARCHIVE_URL'),
      query,
      limit: 5,
      timeoutMs: 4000,
    });
    if (results.length === 0) {
      res.status(200).json(emptyResultsBlock(query));
      return;
    }
    res.status(200).json(resultsBlock(query, results));
  } catch (err: unknown) {
    const reason =
      err instanceof AsaClientError ? err.message : 'unexpected_error';
    console.error('archive_search_failed', {
      reason,
      query_length: query.length,
    });
    res.status(200).json(errorBlock(query, reason));
  }
}

// ---------- helpers ----------

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env_${name}`);
  return v;
}
