/**
 * 日本語Wikipedia（無料・APIキー不要・CORS可）
 *  - Action API:  origin=* を付けると匿名CORSで叩ける
 *  - REST API v1: summary の取得に使う（軽い）
 */

const ACTION_API = 'https://ja.wikipedia.org/w/api.php';
const REST = 'https://ja.wikipedia.org/api/rest_v1';

async function actionApi<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...params,
  });
  const res = await fetch(`${ACTION_API}?${qs.toString()}`, { signal });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  return (await res.json()) as T;
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  type: string;
  thumbnail?: string;
  pageUrl: string;
  wikibaseItem?: string;
}

interface SearchResponse {
  query?: { search?: { title: string; snippet: string }[] };
}

/** 語 → 実在するWikipedia記事名（無ければ null） */
export async function searchTitles(term: string, signal?: AbortSignal): Promise<string[]> {
  const data = await actionApi<SearchResponse>(
    { action: 'query', list: 'search', srsearch: term, srlimit: '5', srnamespace: '0' },
    signal,
  );
  return (data.query?.search ?? []).map((s) => s.title);
}

interface RestSummary {
  title: string;
  displaytitle?: string;
  description?: string;
  extract?: string;
  type?: string;
  thumbnail?: { source: string };
  content_urls?: { desktop?: { page?: string } };
  wikibase_item?: string;
}

export async function fetchSummary(title: string, signal?: AbortSignal): Promise<WikiSummary | null> {
  const res = await fetch(`${REST}/page/summary/${encodeURIComponent(title)}?redirect=true`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia summary ${res.status}`);
  const d = (await res.json()) as RestSummary;
  return {
    title: d.title,
    description: d.description,
    extract: d.extract ?? '',
    type: d.type ?? 'standard',
    thumbnail: d.thumbnail?.source,
    pageUrl:
      d.content_urls?.desktop?.page ??
      `https://ja.wikipedia.org/wiki/${encodeURIComponent(d.title)}`,
    wikibaseItem: d.wikibase_item,
  };
}

interface ParseLinksResponse {
  parse?: { links?: { title: string; ns: number; exists?: boolean }[] };
}

const RELATED_NG =
  /(一覧$|曖昧さ回避|Category:|カテゴリ|ISBN|^\d+年$|^\d+月\d+日$|^\d+年代$|^\d+世紀$|座標|Portal|プロジェクト|Wikipedia|国際標準)/;

/**
 * 関連項目は2系統をまぜる。
 *  1) 記事の導入部(section 0)のリンク = その項目を説明するのに不可欠な語
 *     （名古屋城 → 徳川家康 / 那古野城 / 尾張徳川家）
 *  2) morelike検索 = 似た記事 = 話を横に広げられる語
 *     （名古屋城 → 二条城 / 江戸城 / 熊本城）
 */
export async function fetchRelated(
  title: string,
  summaryText: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<string[]> {
  const [leadLinks, similar] = await Promise.all([
    actionApi<ParseLinksResponse>(
      { action: 'parse', page: title, section: '0', prop: 'links', redirects: '1' },
      signal,
    )
      .then((d) =>
        (d.parse?.links ?? [])
          .filter((l) => l.ns === 0 && l.exists !== false)
          .map((l) => l.title),
      )
      .catch(() => [] as string[]),
    actionApi<SearchResponse>(
      {
        action: 'query',
        list: 'search',
        srsearch: `morelike:${title}`,
        srlimit: '6',
        srnamespace: '0',
        srqiprofile: 'classic',
      },
      signal,
    )
      .then((d) => (d.query?.search ?? []).map((s) => s.title))
      .catch(() => [] as string[]),
  ]);

  const ok = (t: string) =>
    t !== title && t.length >= 2 && !RELATED_NG.test(t) && !t.includes(title);

  // 括弧付き（「中区 (名古屋市)」など）は説明的すぎるので後回し
  const lead = leadLinks.filter(ok);
  const leadPlain = lead.filter((t) => !t.includes('('));
  const leadParen = lead.filter((t) => t.includes('('));
  // 概要文に出てくる語はその項目の中心概念なので優先
  const inSummary = leadPlain.filter((t) => summaryText.includes(t));
  const ordered = [
    ...inSummary.slice(0, 2),
    ...similar.filter(ok).slice(0, 3), // 「横に広げる」候補を必ず混ぜる
    ...inSummary.slice(2),
    ...leadPlain.filter((t) => !summaryText.includes(t)),
    ...similar.filter(ok),
    ...leadParen,
  ];

  const merged: string[] = [];
  for (const t of ordered) {
    if (!merged.includes(t)) merged.push(t);
    if (merged.length >= limit) break;
  }
  return merged;
}

/**
 * 検索フォールバックで拾った記事が、本当にその語の記事かを確かめる。
 *
 * Wikipedia検索は何かしら返してしまうため、これが無いと
 * 「ホームランバッター」→「本塁打」、「大谷翔平のバット」→「指名打者」のような
 * 話していない記事が表示される。タイトルか本文冒頭に語が出ることを条件にする。
 */
function isSameSubject(term: string, s: WikiSummary): boolean {
  const title = s.title.replace(/\s*\(.+\)$/, ''); // 「バット (野球)」の括弧を外す
  // 部分一致だけでは「パッド」→「クックパッド」を通してしまうので、
  // 語とタイトルの長さがほぼ同じ（＝送り仮名や表記ゆれ程度の差）ことを条件にする
  const ratio = Math.min(term.length, title.length) / Math.max(term.length, title.length);
  return (title.includes(term) || term.includes(title)) && ratio >= 0.6;
}

/** 曖昧さ回避ページに当たったときの回避も含めて、語から記事を1本決める */
export async function resolveArticle(
  term: string,
  signal?: AbortSignal,
): Promise<WikiSummary | null> {
  // まずは語そのもので summary を引く（1リクエストで済むケースが多い）
  let summary: WikiSummary | null = null;
  try {
    summary = await fetchSummary(term, signal);
  } catch {
    summary = null;
  }
  if (summary && summary.type === 'standard' && summary.extract) return summary;

  // ダメなら検索にフォールバック（ただし別物を掴まないよう確認する）
  const titles = await searchTitles(term, signal);
  for (const t of titles.slice(0, 3)) {
    const s = await fetchSummary(t, signal);
    if (s && s.type === 'standard' && s.extract && isSameSubject(term, s)) return s;
  }
  return null;
}
