import type { AsaResult } from './asa.js';

/**
 * Build a Slack Block Kit payload from search results.
 *
 * Block Kit is Slack's structured message format — it lets us render each
 * result as a section with an image thumbnail, title, description, and
 * similarity score, instead of dumping a URL blob into the channel.
 * See: https://api.slack.com/block-kit
 */

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackResponse {
  /** in_channel = visible to everyone; ephemeral = only the invoker sees it. */
  response_type: 'in_channel' | 'ephemeral';
  text: string;
  blocks?: SlackBlock[];
}

export function emptyResultsBlock(query: string): SlackResponse {
  return {
    response_type: 'ephemeral',
    text: `No results in Àṣà Archive for "${query}".`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No matches for *${escapeMarkdown(query)}* in the archive yet.`,
        },
      },
    ],
  };
}

export function errorBlock(query: string, reason: string): SlackResponse {
  return {
    response_type: 'ephemeral',
    text: `Search failed: ${reason}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: Couldn't search for *${escapeMarkdown(query)}*. \`${reason}\``,
        },
      },
    ],
  };
}

export function resultsBlock(query: string, results: AsaResult[]): SlackResponse {
  const header: SlackBlock = {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Àṣà Archive — "${query}"`,
      emoji: true,
    },
  };

  const summaryContext: SlackBlock = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Top ${results.length} result${results.length === 1 ? '' : 's'} by semantic similarity`,
      },
    ],
  };

  const resultBlocks: SlackBlock[] = [];
  for (const [i, r] of results.entries()) {
    const title = escapeMarkdown(r.title);
    const desc = r.description ? truncate(escapeMarkdown(r.description), 200) : '';
    const scorePct = Math.round(r.similarity * 100);
    const titleLine = r.detailUrl ? `<${r.detailUrl}|*${title}*>` : `*${title}*`;

    const section: SlackBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${titleLine}\n${desc}\n_similarity ${scorePct}%_`,
      },
    };
    if (r.imageUrl) {
      section.accessory = {
        type: 'image',
        image_url: r.imageUrl,
        alt_text: r.title,
      };
    }
    resultBlocks.push(section);
    if (i < results.length - 1) {
      resultBlocks.push({ type: 'divider' });
    }
  }

  return {
    response_type: 'in_channel',
    text: `Àṣà Archive results for "${query}"`,
    blocks: [header, summaryContext, { type: 'divider' }, ...resultBlocks],
  };
}

// Slack mrkdwn: escape the three characters that break formatting.
function escapeMarkdown(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}
