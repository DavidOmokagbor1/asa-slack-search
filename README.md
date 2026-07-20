# Àṣà Archive — Slack Search Connector

A workplace integration that brings the [Àṣà Archive](https://github.com/DavidOmokagbor1) semantic search into Slack. Type `/asa yoruba textiles` in any Slack channel and get the top matching artifacts back as a Block Kit card.

Built as a serverless Node.js + TypeScript app on Vercel. Slack fires a signed webhook at `/api/slack/commands`, this service verifies the HMAC signature, calls the Àṣà Archive semantic-search endpoint, and returns the results formatted as a rich Slack message.

## Why this exists

The archive already exposes semantic search as a public API. Wrapping it in a Slack slash command turns "look something up in the archive" from a two-step workflow (open browser → search) into one keystroke inside the tool people already have open. Same pattern applies to any internal knowledge base — the connector shape is the reusable part.

## Architecture

```
 Slack user  ─── /asa <query> ───┐
                                 │
                     (signed POST, form-encoded)
                                 │
                                 ▼
                    Vercel serverless function
                    (api/slack/commands.ts)
                       │
             ┌─────────┼──────────────────┐
             ▼         ▼                  ▼
     HMAC signature   Env-based    Àṣà Archive
     verification     config       (/api/search)
     + replay guard                pgvector similarity
                                          │
                                          ▼
                                Block Kit response
                                (headers, sections,
                                 image thumbnails,
                                 similarity scores)
```

Design choices worth calling out:

- **Serverless over long-running.** Slack invocations are bursty and idle most of the time; a Vercel function scales to zero and only bills for real requests.
- **HMAC signature verification is not optional.** If a webhook URL is public, treat it as public. `lib/verify.ts` implements the full Slack recipe including a 5-minute replay window and a constant-time compare.
- **Body parsing is disabled.** Vercel's default JSON parser would consume the request stream before we could hash the raw bytes, and the signature is over the exact bytes Slack sent. We read the body manually and only then parse it as `application/x-www-form-urlencoded`.
- **The archive client is isolated.** `lib/asa.ts` is the only file that knows the archive's HTTP contract. Swap in a different backend (Notion, Confluence, an internal wiki) and the Slack handler doesn't change.
- **Errors return a nice ephemeral message.** A failed search shouldn't blast a stack trace into a public channel. The `errorBlock` helper keeps failures visible only to the invoker.

## Local development

```bash
npm install
cp .env.example .env
# fill in SLACK_SIGNING_SECRET and ASA_ARCHIVE_URL
npm run dev              # Vercel dev server on :3000
```

To test the endpoint end-to-end against a real Slack app locally, tunnel with `ngrok http 3000` and point the slash-command Request URL at the ngrok URL + `/api/slack/commands`.

## Test suite

```bash
npm test
```

Covers the signature verifier's happy path plus every failure mode: tampered body, wrong secret, stale timestamp, future timestamp, missing headers, non-numeric timestamp. The verifier is the security boundary, so it gets the most test attention.

## Deploying to Vercel

1. Push this repo to GitHub.
2. `vercel link` this directory (or import via the Vercel dashboard).
3. Set both env vars in the Vercel project (Production + Preview): `SLACK_SIGNING_SECRET`, `ASA_ARCHIVE_URL`.
4. `vercel --prod`.
5. Copy the deployed URL, e.g. `https://asa-slack-search.vercel.app`.

## Setting up the Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. **Basic Information** → copy the **Signing Secret** into Vercel's `SLACK_SIGNING_SECRET`.
3. **Slash Commands** → **Create New Command**:
   - Command: `/asa`
   - Request URL: `https://<your-vercel-url>/api/slack/commands`
   - Short description: `Search the Àṣà Archive`
   - Usage hint: `<search terms>`
4. **Install App** → **Install to Workspace**, approve the scopes.
5. In any channel, type `/asa yoruba textiles` — you should see results within ~1 second.

## Notes on the archive contract

`lib/asa.ts` assumes the archive answers `GET /api/search?q={query}&limit={n}` with:

```json
{
  "results": [
    {
      "id": "...",
      "title": "...",
      "description": "...",
      "imageUrl": "...",
      "similarity": 0.87,
      "detailUrl": "..."
    }
  ]
}
```

If the real endpoint uses different field names, adjust the `AsaResult` interface and the `resultsBlock` formatter accordingly — that's the only surface that needs to change.

## What this doesn't do (and why that's fine)

- **No multi-workspace OAuth flow.** This is a single-workspace install. Adding OAuth is a real project on its own; it doesn't change the core integration pattern.
- **No result caching.** Each command hits the archive fresh. If traffic warrants it, a lightweight LRU or edge cache in front of the archive is the right layer, not this service.
- **No agentic behavior.** The slash command is a direct passthrough. The archive itself is where semantic reasoning lives — this connector's job is transport and formatting.

## License

MIT.
