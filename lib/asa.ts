/**
 * Thin fetch client for the Àṣà Archive semantic-search endpoint.
 *
 * We assume the archive exposes a search endpoint that returns artifacts
 * ranked by cosine similarity against a text embedding of the query.
 * If your endpoint contract differs (e.g. POST body, different field
 * names), only this file needs to change — the Slack handler consumes
 * a typed AsaResult shape.
 */

export interface AsaResult {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  similarity: number;
  /** Public detail-page URL for this artifact. */
  detailUrl?: string;
}

export interface AsaSearchResponse {
  results: AsaResult[];
}

export interface SearchOptions {
  archiveBaseUrl: string;
  query: string;
  limit?: number;
  /** Fetch timeout in milliseconds. Kept tight because Slack expects a fast turn-around. */
  timeoutMs?: number;
}

export class AsaClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'AsaClientError';
  }
}

export async function searchArchive(opts: SearchOptions): Promise<AsaResult[]> {
  const { archiveBaseUrl, query, limit = 5, timeoutMs = 4000 } = opts;
  if (!archiveBaseUrl) throw new AsaClientError('archive_base_url_missing');
  if (!query.trim()) return [];

  const url = new URL('/api/search', archiveBaseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new AsaClientError(`archive_bad_status_${res.status}`, res.status);
    }
    const data = (await res.json()) as AsaSearchResponse;
    if (!Array.isArray(data.results)) {
      throw new AsaClientError('archive_bad_shape');
    }
    return data.results;
  } catch (err: unknown) {
    if (err instanceof AsaClientError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AsaClientError('archive_timeout');
    }
    throw new AsaClientError(
      err instanceof Error ? err.message : 'archive_unknown_error'
    );
  } finally {
    clearTimeout(timer);
  }
}
