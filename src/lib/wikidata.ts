/**
 * Wikidata（無料・APIキー不要・CORS可）から情報カードの項目を作る。
 *
 * 表示項目は固定しない。ホワイトリストにあるプロパティのうち
 * 「そのエンティティが実際に持っているもの」だけを、優先度順に最大8件出す。
 * → 人物なら生没年/職業、企業なら設立/創業者/本社、建造物なら建設年/所在地 が自然に出る。
 */

import type { Fact } from '../types';

const API = 'https://www.wikidata.org/w/api.php';

/** 表示したいプロパティ: [PID, 日本語ラベル, 優先度(小さいほど上)] */
const PROPS: [string, string, number][] = [
  // 分類
  ['P31', '分類', 90],
  // 人物
  ['P569', '生年', 10],
  ['P570', '没年', 11],
  ['P106', '職業', 12],
  ['P27', '国籍', 13],
  ['P39', '役職', 14],
  ['P800', '代表作', 15],
  ['P26', '配偶者', 40],
  ['P22', '父', 41],
  ['P40', '子', 42],
  ['P69', '出身校', 43],
  ['P19', '出生地', 20],
  ['P20', '死没地', 21],
  // 組織・企業
  ['P571', '設立・創建', 10],
  ['P112', '創設者', 11],
  ['P169', 'CEO', 14],
  ['P159', '本社', 12],
  ['P452', '業種', 13],
  ['P1128', '従業員数', 30],
  ['P2139', '売上高', 31],
  ['P1454', '法人形態', 44],
  // 場所・建造物
  ['P17', '国', 22],
  ['P131', '所在地', 12],
  ['P625', '座標', 99],
  ['P84', '設計者', 13],
  ['P1398', '前身', 45],
  ['P2048', '高さ', 32],
  ['P1435', '文化財指定', 33],
  ['P149', '建築様式', 34],
  ['P1082', '人口', 30],
  ['P36', '首都', 23],
  ['P37', '公用語', 24],
  // 作品・出来事
  ['P577', '公開・発表', 10],
  ['P50', '著者', 11],
  ['P57', '監督', 11],
  ['P58', '脚本', 16],
  ['P86', '音楽', 17],
  ['P136', 'ジャンル', 13],
  ['P123', '出版・製作', 14],
  ['P585', '発生時期', 10],
  ['P580', '開始', 10],
  ['P582', '終了', 11],
  ['P276', '場所', 12],
  ['P710', '参加者', 15],
  ['P361', '一部', 46],
  ['P138', '名称の由来', 47],
  ['P178', '開発元', 12],
  ['P176', '製造', 13],
];

const PROP_ORDER = new Map(PROPS.map(([pid, , order]) => [pid, order]));
const PROP_LABEL = new Map(PROPS.map(([pid, label]) => [pid, label]));

interface Snak {
  snaktype: string;
  property: string;
  datavalue?: {
    type: string;
    value: unknown;
  };
}

interface Claim {
  mainsnak: Snak;
  rank: string;
}

interface EntityResponse {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value: string }>;
      descriptions?: Record<string, { value: string }>;
      claims?: Record<string, Claim[]>;
    }
  >;
}

async function wdApi<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const res = await fetch(`${API}?${qs.toString()}`, { signal });
  if (!res.ok) throw new Error(`Wikidata API ${res.status}`);
  return (await res.json()) as T;
}

function formatTime(value: { time: string; precision: number }): string {
  // 例: "+1609-00-00T00:00:00Z", precision 9=年 10=月 11=日
  const m = /^([+-])(\d{4,})-(\d{2})-(\d{2})/.exec(value.time);
  if (!m) return value.time;
  const bc = m[1] === '-';
  const year = parseInt(m[2], 10);
  const month = parseInt(m[3], 10);
  const day = parseInt(m[4], 10);
  const y = `${bc ? '紀元前' : ''}${year}年`;
  if (value.precision >= 11 && month && day) return `${y}${month}月${day}日`;
  if (value.precision >= 10 && month) return `${y}${month}月`;
  if (value.precision === 8) return `${year}年代`;
  if (value.precision === 7) return `${Math.floor(year / 100) + 1}世紀`;
  return y;
}

function formatQuantity(value: { amount: string; unit: string }): {
  text: string;
  unitId?: string;
} {
  const num = Number(value.amount);
  const text = Number.isFinite(num) ? num.toLocaleString('ja-JP') : value.amount;
  const unitId = value.unit && value.unit !== '1' ? value.unit.split('/').pop() : undefined;
  return { text, unitId };
}

/** ラベル解決（Qxx → 日本語ラベル）。50件ずつまとめて引く */
async function fetchLabels(ids: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const data = await wdApi<EntityResponse>(
      {
        action: 'wbgetentities',
        ids: chunk.join('|'),
        props: 'labels',
        languages: 'ja|en',
        languagefallback: '1',
      },
      signal,
    );
    for (const [id, ent] of Object.entries(data.entities ?? {})) {
      const label = ent.labels?.ja?.value ?? ent.labels?.en?.value;
      if (label) out.set(id, label);
    }
  }
  return out;
}

export interface WikidataInfo {
  facts: Fact[];
  description?: string;
  url: string;
}

export async function fetchEntityFacts(
  qid: string,
  signal?: AbortSignal,
): Promise<WikidataInfo | null> {
  const data = await wdApi<EntityResponse>(
    {
      action: 'wbgetentities',
      ids: qid,
      props: 'claims|descriptions',
      languages: 'ja|en',
      languagefallback: '1',
    },
    signal,
  );
  const ent = data.entities?.[qid];
  if (!ent) return null;

  const url = `https://www.wikidata.org/wiki/${qid}`;
  const claims = ent.claims ?? {};

  // 1. 対象プロパティを拾って、ラベル解決が必要なQIDを集める
  interface Raw {
    pid: string;
    order: number;
    values: { text?: string; entityId?: string }[];
  }
  const raws: Raw[] = [];
  const needLabels: string[] = [];

  for (const [pid, order] of PROP_ORDER) {
    if (pid === 'P625') continue; // 座標は収録中に読む情報ではない
    const cs = (claims[pid] ?? []).filter(
      (c) => c.rank !== 'deprecated' && c.mainsnak.snaktype === 'value',
    );
    if (cs.length === 0) continue;
    const values: Raw['values'] = [];
    for (const c of cs.slice(0, 3)) {
      const dv = c.mainsnak.datavalue;
      if (!dv) continue;
      switch (dv.type) {
        case 'wikibase-entityid': {
          const id = (dv.value as { id?: string }).id;
          if (id) {
            values.push({ entityId: id });
            needLabels.push(id);
          }
          break;
        }
        case 'time':
          values.push({ text: formatTime(dv.value as { time: string; precision: number }) });
          break;
        case 'quantity': {
          const q = formatQuantity(dv.value as { amount: string; unit: string });
          if (q.unitId) needLabels.push(q.unitId);
          values.push({ text: q.text, entityId: q.unitId ? `UNIT:${q.unitId}` : undefined });
          break;
        }
        case 'string':
          values.push({ text: String(dv.value) });
          break;
        case 'monolingualtext':
          values.push({ text: (dv.value as { text: string }).text });
          break;
        default:
          break;
      }
    }
    if (values.length > 0) raws.push({ pid, order, values });
  }

  const labels = await (needLabels.length > 0
    ? fetchLabels(
        needLabels.map((i) => i.replace(/^UNIT:/, '')),
        signal,
      )
    : Promise.resolve(new Map<string, string>()));

  // 2. Fact に整形
  const facts: Fact[] = [];
  for (const raw of raws.sort((a, b) => a.order - b.order)) {
    const parts: string[] = [];
    for (const v of raw.values) {
      if (v.entityId?.startsWith('UNIT:')) {
        const unit = labels.get(v.entityId.slice(5));
        parts.push(unit ? `${v.text} ${unit}` : (v.text ?? ''));
      } else if (v.entityId) {
        const l = labels.get(v.entityId);
        if (l) parts.push(l);
      } else if (v.text) {
        parts.push(v.text);
      }
    }
    if (parts.length === 0) continue;
    facts.push({
      label: PROP_LABEL.get(raw.pid) ?? raw.pid,
      value: parts.join('、'),
      url: `https://www.wikidata.org/wiki/Property:${raw.pid}`,
    });
    if (facts.length >= 8) break;
  }

  return {
    facts,
    description: ent.descriptions?.ja?.value ?? ent.descriptions?.en?.value,
    url,
  };
}
