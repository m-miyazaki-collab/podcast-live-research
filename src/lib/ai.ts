/**
 * 将来の「AIで調べる」用の差し替え可能なレイヤー。
 *
 * 初期バージョンの原則:
 *   - APIキーはコードに一切埋め込まない（設定画面から入力 → localStorage のみ）
 *   - 未設定なら AI 機能は無効。アプリの基本機能はこれに一切依存しない
 *   - 呼ぶのは「ユーザーがボタンを押したとき」だけ。常時実行はしない（= 常時課金しない）
 *
 * 将来ここに足せるもの: ファクトチェック / 追加リサーチ / Show Notes 生成 /
 * チャプター生成 など。いずれも buildRequest() の task を増やすだけで済む形にしてある。
 */

import type { TopicCard } from '../types';

export type AiProvider = 'anthropic' | 'openai-compatible';

export interface AiConfig {
  provider: AiProvider;
  /** openai-compatible のときのエンドポイント（自前プロキシ推奨） */
  endpoint?: string;
  model: string;
  apiKey: string;
}

export type AiTask = 'answer' | 'factcheck' | 'expand';

export interface AiRequest {
  task: AiTask;
  topic?: TopicCard | null;
  /** 直近30〜60秒の文字起こし */
  transcript: string;
  /** ユーザーの質問（任意） */
  question?: string;
}

const CONFIG_KEY = 'plr:ai-config:v1';

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as AiConfig;
    return c.apiKey && c.model ? c : null;
  } catch {
    return null;
  }
}

export function saveAiConfig(c: AiConfig | null): void {
  if (!c) localStorage.removeItem(CONFIG_KEY);
  else localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export function isAiEnabled(): boolean {
  return loadAiConfig() !== null;
}

const TASK_INSTRUCTION: Record<AiTask, string> = {
  answer:
    'ポッドキャスト収録中のリサーチャーとして、直近の会話と現在のトピックを踏まえて質問に答えてください。',
  factcheck:
    'ポッドキャスト収録中のファクトチェッカーとして、直近の発言の事実関係を確認し、誤りがあれば正しい情報を示してください。',
  expand:
    'ポッドキャスト収録中のリサーチャーとして、いまの話題から会話を広げられる関連情報を提示してください。',
};

export function buildPrompt(req: AiRequest): string {
  const lines: string[] = [TASK_INSTRUCTION[req.task], ''];
  if (req.topic) {
    lines.push(`# 現在のトピック: ${req.topic.title}`);
    if (req.topic.summary) lines.push(req.topic.summary);
    if (req.topic.facts.length > 0) {
      lines.push(...req.topic.facts.map((f) => `- ${f.label}: ${f.value}`));
    }
    lines.push('');
  }
  lines.push('# 直近の会話（音声認識のため誤認識を含む）', req.transcript, '');
  if (req.question) lines.push('# 質問', req.question, '');
  lines.push(
    '# 出力ルール',
    '- 収録中に一瞬で読めるよう、箇条書き3〜5行以内',
    '- 確実でない点は「未確認」と明示する。推測を事実として書かない',
    '- 可能なら出典（URLまたは媒体名）を添える',
  );
  return lines.join('\n');
}

export interface AiResult {
  text: string;
}

/** 設定済みのときだけ呼ばれる。未設定なら例外。 */
export async function askAi(req: AiRequest, signal?: AbortSignal): Promise<AiResult> {
  const config = loadAiConfig();
  if (!config) throw new Error('AI設定が未登録です（設定画面からAPIキーを入力してください）');

  const prompt = buildPrompt(req);

  if (config.provider === 'anthropic') {
    const res = await fetch(config.endpoint || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        // ブラウザから直接叩く場合に必要。本番は自前プロキシ経由を推奨。
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return { text };
  }

  // OpenAI互換（自前プロキシ / ローカルLLM / 無料枠のOpenAI互換APIなど）
  const res = await fetch(config.endpoint || '/api/chat', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
    }),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return { text: data.choices?.[0]?.message?.content ?? '' };
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  apiKey: '',
};
