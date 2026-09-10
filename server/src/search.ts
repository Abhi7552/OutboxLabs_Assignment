import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';

export const searchClient = new Client({ node: config.ELASTICSEARCH_URL });
const index = 'reachinbox-emails';

export async function ensureSearchIndex() {
  try {
    const exists = await searchClient.indices.exists({ index });
    if (!exists) {
      await searchClient.indices.create({ index, mappings: { properties: {
        recipient: { type: 'text' }, subject: { type: 'text' }, body: { type: 'text' },
        status: { type: 'keyword' }, scheduledAt: { type: 'date' }, sentAt: { type: 'date' }
      } } });
    }
  } catch (error) {
    console.warn('Elasticsearch is unavailable; relational search remains active.', error instanceof Error ? error.message : error);
  }
}

export async function indexEmail(email: { id: string; recipient: string; subject: string; body: string; status: string; scheduledAt: Date; sentAt: Date | null }) {
  try {
    await searchClient.index({ index, id: email.id, document: email });
  } catch (error) {
    console.warn('Email index update failed:', error instanceof Error ? error.message : error);
  }
}

export async function searchEmails(query: string, status?: string) {
  try {
    const result = await searchClient.search<{ id: string }>({
      index, size: 100,
      query: { bool: { must: query ? [{ multi_match: { query, fields: ['recipient', 'subject', 'body'] } }] : [{ match_all: {} }], filter: status ? [{ term: { status } }] : [] } }
    });
    return result.hits.hits.map((hit) => hit._id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}
