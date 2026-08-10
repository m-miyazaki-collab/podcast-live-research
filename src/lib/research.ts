/**
 * 語 → 情報カード(TopicCard) を組み立てる。
 * キャッシュ（メモリ + localStorage）を必ず通すので、同じトピックは1回しか取りに行かない。
 * 情報源が取れなかった項目は「推測で埋めない」= 出さない。
 */

import { cacheGet, cacheSet } from './cache';
import type { TopicCard } from '../types';
import { fetchRelated, resolveArticle } from './wikipedia';
import { fetchEntityFacts } from './wikidata';

const CARD_TTL = 1000 * 60 * 60 * 24 * 7; // 7日
const MISS_TTL = 1000 * 60 * 60 * 24; // 記事なしは1日だけ覚える

const cardKey = (q: string) => `card:${q}`;
const missKey = (q: string) => `miss:${q}`;

export class NotFoundError extends Error {
  constructor(public query: string) {
    super(`「${query}」に該当するWikipedia記事が見つかりませんでした`);
  }
}

/** キャッシュのみを見る（ネットワークを使わない） */
export function getCachedCard(query: string): TopicCard | null {
  return cacheGet<TopicCard>(cardKey(query), CARD_TTL);
}

export function isKnownMiss(query: string): boolean {
  return cacheGet<boolean>(missKey(query), MISS_TTL) === true;
}

export async function researchTopic(
  query: string,
  signal?: AbortSignal,
): Promise<TopicCard> {
  const cached = getCachedCard(query);
  if (cached) return cached;

  const article = await resolveArticle(query, signal);
  if (!article) {
    cacheSet(missKey(query), true);
    throw new NotFoundError(query);
  }

  // 記事名でもキャッシュを引き直す（別名から同じ記事に来た場合の重複取得を防ぐ）
  if (article.title !== query) {
    const byTitle = getCachedCard(article.title);
    if (byTitle) {
      cacheSet(cardKey(query), byTitle);
      return byTitle;
    }
  }

  const [related, wd] = await Promise.all([
    fetchRelated(article.title, article.extract, 5, signal).catch(() => [] as string[]),
    article.wikibaseItem
      ? fetchEntityFacts(article.wikibaseItem, signal).catch(() => null)
      : Promise.resolve(null),
  ]);

  const card: TopicCard = {
    query,
    title: article.title,
    description: article.description ?? wd?.description,
    summary: trimSummary(article.extract),
    facts: wd?.facts ?? [],
    related,
    wikipediaUrl: article.pageUrl,
    wikidataUrl: wd?.url,
    thumbnail: article.thumbnail,
    fetchedAt: Date.now(),
  };

  cacheSet(cardKey(query), card);
  if (article.title !== query) cacheSet(cardKey(article.title), card);
  return card;
}

/** 収録中に一瞬で読める長さに切る（3文 or 160文字まで） */
function trimSummary(extract: string): string {
  // 古いSafariでも壊れないよう、正規表現の後読みは使わずに文を切り出す
  const text = extract.replace(/\s+/g, ' ').trim();
  const sentences: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '。') {
      sentences.push(buf);
      buf = '';
    }
  }
  if (buf) sentences.push(buf);

  let out = '';
  let count = 0;
  for (const s of sentences) {
    if (out.length > 0 && out.length + s.length > 160) break;
    out += s;
    count += 1;
    if (count >= 3) break;
  }
  return out || text.slice(0, 160);
}
