/**
 * ルールベースの日本語トピック抽出。
 * 形態素解析器は使わない（バンドルサイズ・無料運用のため）。
 *
 * 考え方:
 *   日本語は「漢字・カタカナ・英数字の連続」が固有名詞になりやすく、
 *   助詞・助動詞はひらがななので、文字種の切れ目でだいたい名詞が取れる。
 *   そこから ストップワード除去 → スコアリング（新しさ×頻度×長さ×質問近接）
 *   で「いま話している主題」を1語選ぶ。
 */

/** トピック判定に使う会話の窓。長すぎると話題が切り替わっても古い語が勝ち続ける */
export const TOPIC_WINDOW_MS = 30000;

const KANJI = '\\u4E00-\\u9FFF\\u3005\\u3006\\u3007';
const KATAKANA = '\\u30A1-\\u30FA\\u30FC\\u30FD\\u30FE';
const LATIN = 'A-Za-z0-9';

// 漢字/カタカナ/英数字が連続する塊（「東京タワー」「iPhone」「名古屋城」など）
const TOKEN_BODY = `[${KANJI}${KATAKANA}${LATIN}][${KANJI}${KATAKANA}${LATIN}ー・々\\-']*`;
const TOKEN_RE = new RegExp(TOKEN_BODY, 'g');
// 「ノルウェイの森」「尾張徳川家の当主」のように "の" を挟む固有名詞を拾う
const NO_JOIN_RE = new RegExp(`(${TOKEN_BODY})の(${TOKEN_BODY})`, 'g');

/** 単体では話題にならない一般語・話し言葉のノイズ */
const STOPWORDS = new Set<string>([
  'これ', 'それ', 'あれ', 'ここ', 'そこ', 'あそこ', 'この', 'その', 'あの',
  '今日', '昨日', '明日', '今回', '前回', '次回', '今', '最近', '今度', '当時',
  '自分', '感じ', '感じで', '普通', '本当', '結構', '多分', '一応', '一番', '全部',
  '話', '話し', '内容', '意味', '感想', '部分', '場合', '感覚', '状態', '状況',
  '人', '人達', '方', '事', '物', '所', '中', '上', '下', '前', '後', '時', '間',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千', '万', '億',
  '何', '誰', '何時', '何処', '何故', '如何', '為', '的', '等', '達', '様', '君', '氏',
  '思う', '思い', '思っ', '言う', '言っ', '見る', '見て', '行く', '行っ', '来る', '来て',
  '知っ', '知ら', '分かる', '分かっ', '出来', '作っ', '作る', '使っ', '使う', '入っ',
  // 「トピックそのもの」ではなく「トピックについて知りたい属性」を表す語
  '創業者', '作者', '著者', '意味', '理由', '場所', '名前', '由来', '起源', '歴史',
  '目的', '特徴', '種類', '方法', '影響', '関係', '出身', '年齢', '値段', '価格',
  '規模', '人数', '距離', '広さ', '高さ', '長さ', '順番', '違い', '定義', '正式名称',
  // 会話の地の語
  '昨日', '一昨日', '明後日', '今年', '去年', '来年', '今週', '先週', '来週', '先日',
  'ニュース', 'テレビ', 'ネット', 'サイト', 'アプリ', 'メール', 'ネタ', 'ヤバ', 'ヤバい',
  'ヤツ', 'ヤバイ', 'ホント', 'メチャ', 'メッチャ', 'チョット', 'ソレ', 'コレ',
  'エッ', 'アノ', 'ソノ', 'ソウ', 'ナンカ', 'ナニ', 'ドコ', 'ダレ', 'ミタイ', 'カンジ',
  'ハイ', 'ウン', 'エー', 'アー', 'ソウソウ', 'ナルホド', 'トカ', 'ケド', 'デス', 'マス',
  'ポッドキャスト', 'ラジオ', 'マイク', 'リスナー', 'コーナー',
  'OK', 'NG', 'the', 'The', 'a', 'an', 'and', 'is', 'it',
  // 日常語（調べても「誰でも知っていること」しか出ないので話題にしない）
  '自転車', '自動車', '電車', '新幹線', '飛行機', '自動販売機', '携帯', '電話', '電池', '電源',
  '時計', '財布', '眼鏡', '椅子', '部屋', '会社', '学校', '病院', '駅前', '道路', '信号',
  '料理', '野菜', '果物', '飲み物', '食べ物', '天気', '温泉', '旅行', '写真', '動画',
  '音楽', '映画', '漫画', '小説', '雑誌', '新聞', '番組', '収録', '編集', '仕事', '趣味',
  'カメラ', 'パソコン', 'スマホ', 'スマートフォン', 'ヘッドフォン', 'ヘッドホン', 'イヤホン',
  'ケーブル', 'ボタン', 'データ', 'ファイル', 'メニュー', 'ページ', 'サイズ', 'カラー',
  'デザイン', 'スピード', 'パワー', 'レベル', 'タイプ', 'ケース', 'チェック', 'スタート',
  'ストップ', 'プラットホーム', 'テーブル', 'ソファ', 'ベッド', 'エアコン', 'コーヒー',
]);

/** 数量・日付そのもの（トピックではなく Fact 側の情報） */
const NUMERIC_RE = /^[0-9０-９]+(年|月|日|時|分|秒|回|人|個|円|％|%|km|kg|m|cm)?$/;

export interface Candidate {
  term: string;
  score: number;
  /** 最後に出現した時刻(ms) */
  lastAt: number;
  /** 何回出てきたか（1回だけの語は音声認識の誤りが多い） */
  count: number;
}

export interface WindowedText {
  /** 確定済みテキスト（新しい順の判定に使うため ts 付き） */
  text: string;
  ts: number;
  final: boolean;
}

function isNoise(term: string): boolean {
  if (STOPWORDS.has(term)) return true;
  if (NUMERIC_RE.test(term)) return true;
  // 1文字の漢字・カタカナは固有名詞として弱すぎる
  if (term.length < 2) return true;
  // 「ーー」「・・」だけ等
  if (/^[ー・\-']+$/.test(term)) return true;
  // 全部ひらがなは TOKEN_RE で拾わないのでここには来ない
  return false;
}

/** 前の語とくっついて拾われやすい接頭辞（「この"前名古屋"に」対策） */
const PREFIX_NOISE = /^(前|後|今|元|約|超|各|全|当|同|本|昨|来|新|旧|再|大|小)/;

/** 「名古屋城」から「名古屋」も候補に出す（部分語も拾って親トピックを見つける） */
function subTerms(term: string): string[] {
  const out: string[] = [];
  // 文字種の変わり目で分割（「東京タワー」→「東京」「タワー」）
  const parts = term.match(
    new RegExp(`[${KANJI}々]+|[${KATAKANA}ー]+|[${LATIN}\\-']+`, 'g'),
  );
  if (parts && parts.length > 1) out.push(...parts);
  // 「前名古屋」→「名古屋」
  if (term.length >= 3 && PREFIX_NOISE.test(term)) out.push(term.slice(1));
  // 「昨日トヨタ自動車」→「トヨタ自動車」（先頭にくっついた一般語を剥がす）
  for (let n = 3; n >= 2; n--) {
    if (term.length > n + 1 && STOPWORDS.has(term.slice(0, n))) {
      out.push(term.slice(n));
      break;
    }
  }
  return out.filter((p) => !isNoise(p));
}

/**
 * "AのB" として連結してよい部品か。
 * B側は「森」「城」「国」のような1文字漢字も許す（ノルウェイの森 対策）。
 */
// 1文字でも名詞として成立しやすい漢字だけを許可する（「新しい」の「新」を弾くため）
const NOUN_KANJI = new Set(
  '森山川島湖海城寺社塔橋港駅市町村区郡県州国家党軍戦役乱陣館堂門塚墓道路線王帝主神仏法'.split(''),
);
function isJoinPart(p: string, isTail: boolean): boolean {
  if (p.length > 6 || STOPWORDS.has(p) || NUMERIC_RE.test(p)) return false;
  if (p.length >= 2) return true;
  return isTail && NOUN_KANJI.has(p);
}

/** 疑問詞は語の一部として拾わない（「創業者誰」→「創業者」） */
const INTERROGATIVE_SPLIT = /[誰何幾孰]/;

/** 1つの文字列トークンから、候補となる語のバリエーションを作る（先頭が本命） */
function variantsOf(raw: string): string[] {
  // 末尾の「ー」は削らない（ソニー→ソニ、コーヒー→コーヒ になってしまう）。
  // 連続した長音や中黒だけを整える。
  const base = raw.replace(/[・\-']+$/, '').replace(/ー{2,}$/, 'ー');
  const out: string[] = [];
  for (const piece of base.split(INTERROGATIVE_SPLIT)) {
    if (!piece) continue;
    out.push(piece);
    out.push(...subTerms(piece));
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of out) {
    if (isNoise(t) || seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }
  return uniq;
}

/** 質問らしさを検出して、質問文そのものを返す */
const QUESTION_RE =
  /(誰|だれ|いつ|どこ|なぜ|なんで|どうして|何年|なんねん|何で|どっち|どの|どんな|いくつ|いくら|何|なに)/;
const QUESTION_TAIL_RE = /(っけ|ですか|ますか|かな|かなあ|だろう|でしょうか|の\?|\?|？)\s*$/;

export function detectQuestion(text: string): string | null {
  const sentences = text
    .split(/[。．！!？?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = sentences.length - 1; i >= 0 && i >= sentences.length - 3; i--) {
    const s = sentences[i];
    if (QUESTION_RE.test(s) && (QUESTION_TAIL_RE.test(s) || /(っけ|かな|ですか|ますか)/.test(s))) {
      return s.length > 60 ? s.slice(-60) : s;
    }
  }
  // 「？」だけで終わる文も質問扱い
  const m = text.match(/([^。．\n]{2,60}[？?])\s*$/);
  return m ? m[1] : null;
}

/**
 * 直近の会話（新しいものほど強い）から主題候補を抽出する。
 * @param items 時系列順（古い→新しい）のテキスト片
 * @param now   現在時刻
 * @param windowMs 何ミリ秒ぶんを見るか
 */
export function extractCandidates(
  items: WindowedText[],
  now: number = Date.now(),
  windowMs = TOPIC_WINDOW_MS,
): Candidate[] {
  const scores = new Map<string, Candidate>();
  const recent = items.filter((it) => now - it.ts <= windowMs);
  if (recent.length === 0) return [];

  // 認識結果の1チャンク＝1文として扱う（区切りが無いと文単位の質問判定ができない）
  const questionHint = detectQuestion(recent.map((r) => r.text).join('。'));

  for (const item of recent) {
    const age = Math.max(0, now - item.ts);
    // 新しさ: いま話している語を強く優先する（10秒前で約1/3、30秒前でほぼ無視）
    const recency = 0.05 + 0.95 * Math.exp(-age / 9000);
    // 認識途中の文字列は確度が低いので少し割り引く
    const confidence = item.final ? 1.0 : 0.75;

    const found = item.text.match(TOKEN_RE) || [];
    // "AのB" 形の複合語も1語として候補に入れる（実在確認はWikipedia側でやる）
    const joined: string[] = [];
    NO_JOIN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NO_JOIN_RE.exec(item.text)) !== null) {
      if (isJoinPart(m[1], false) && isJoinPart(m[2], true)) joined.push(`${m[1]}の${m[2]}`);
    }

    for (const raw of [...found, ...joined]) {
      const variants = raw.includes('の') ? [raw] : variantsOf(raw);
      for (let vi = 0; vi < variants.length; vi++) {
        const t = variants[vi];
        // 長い語ほど固有名詞らしい（4文字で頭打ち）
        const lengthWeight = Math.min(t.length, 4) / 2;
        // 部分語はやや弱め
        const partWeight = vi === 0 ? 1.0 : 0.6;
        // 質問文の中に出てくる語は「いま知りたい対象」の可能性が高い
        const qWeight = questionHint && questionHint.includes(t) ? 1.6 : 1.0;
        const add = recency * confidence * lengthWeight * partWeight * qWeight;

        const cur = scores.get(t);
        if (cur) {
          cur.score += add;
          cur.count += 1;
          cur.lastAt = Math.max(cur.lastAt, item.ts);
        } else {
          scores.set(t, { term: t, score: add, lastAt: item.ts, count: 1 });
        }
      }
    }
  }

  // 「名古屋」と「名古屋城」が両方あるとき、長い方（より具体的な方）を優先する
  const list = [...scores.values()];
  for (const c of list) {
    for (const other of list) {
      if (other.term !== c.term && other.term.includes(c.term)) {
        // 上位語は下位語のスコアを一部吸い上げられる側なので減点
        c.score *= 0.7;
      }
    }
  }

  return list.sort((a, b) => b.score - a.score || b.lastAt - a.lastAt).slice(0, 8);
}

export interface TopicGuess {
  term: string;
  /** 同時に検出された質問（あれば表示に使う） */
  question: string | null;
  candidates: Candidate[];
}

export function guessTopic(items: WindowedText[], now = Date.now()): TopicGuess | null {
  const candidates = extractCandidates(items, now);
  if (candidates.length === 0) return null;
  const text = items
    .filter((it) => now - it.ts <= TOPIC_WINDOW_MS)
    .map((r) => r.text)
    .join('。');
  return { term: candidates[0].term, question: detectQuestion(text), candidates };
}
