/**
 * 検出した質問に、情報カードの中の「答えになりそうな項目」を対応づける。
 *
 * 「名古屋城って誰が作ったんだっけ？」→ 創設者: 徳川家康 を答えとして目立たせる。
 * あくまで Wikidata に入っている事実を選ぶだけで、文章の生成も推測もしない。
 * 対応する項目が無ければ何も出さない。
 */

import type { Fact } from '../types';

/** 疑問詞 → その答えになりうる項目ラベル（wikidata.ts の PROPS のラベルと対応） */
const QUESTION_TO_LABELS: [RegExp, string[]][] = [
  [
    /(誰|だれ|どなた)/,
    [
      '創設者', '著者', '監督', '脚本', '音楽', '開発元', '製造', '所有者', 'CEO',
      '設計者', '父', '子', '配偶者', '参加者', '登場人物', '親会社',
    ],
  ],
  [
    /(いつ|何年|なんねん|何時代|いつごろ|いつ頃)/,
    ['設立・創建', '生年', '没年', '発生時期', '公開・発表', '開始', '終了'],
  ],
  [
    /(どこ|何県|どこら|どの辺|場所)/,
    ['所在地', '本社', '場所', '出生地', '死没地', '国', '活動地', '面する水域'],
  ],
  [/(何歳|年齢|生まれ)/, ['生年', '没年']],
  [/(何人|人口|従業員|規模|いくら|売上|面積|高さ|身長)/, ['人口', '従業員数', '売上高', '面積', '高さ・身長']],
  [/(何をし|何者|職業|どんな人)/, ['職業', '役職', '所属', '受賞']],
  [/(何の|どんな|ジャンル|種類)/, ['ジャンル', '業種', '主題', '分類']],
];

export interface AnsweredFact {
  fact: Fact;
  /** どの疑問詞に反応したか（UIには出さないがデバッグ用） */
  matched: string;
}

export function findAnswer(question: string | null, facts: Fact[]): AnsweredFact | null {
  if (!question || facts.length === 0) return null;
  for (const [re, labels] of QUESTION_TO_LABELS) {
    const m = re.exec(question);
    if (!m) continue;
    for (const label of labels) {
      const fact = facts.find((f) => f.label === label);
      if (fact) return { fact, matched: m[0] };
    }
  }
  return null;
}
