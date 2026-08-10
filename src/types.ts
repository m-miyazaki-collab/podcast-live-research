/** 文字起こしの1チャンク（確定 or 認識途中） */
export interface TranscriptChunk {
  id: string;
  text: string;
  final: boolean;
  ts: number;
}

/** 情報カードの1項目。Wikidataの内容に応じて中身が変わる */
export interface Fact {
  label: string;
  value: string;
  /** 参照先（Wikidata項目など）。無い場合もある */
  url?: string;
}

/** NOWカード／RECENT履歴の実体 */
export interface TopicCard {
  /** 検索に使った語（音声から拾った語） */
  query: string;
  /** Wikipediaの正式記事名 */
  title: string;
  description?: string;
  summary: string;
  facts: Fact[];
  related: string[];
  wikipediaUrl: string;
  wikidataUrl?: string;
  thumbnail?: string;
  fetchedAt: number;
}

export type ResearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; card: TopicCard }
  | { status: 'notfound'; query: string }
  | { status: 'error'; query: string; message: string };
