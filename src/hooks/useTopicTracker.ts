import { useEffect, useRef, useState } from 'react';
import { guessTopic, type WindowedText } from '../lib/topic';

/**
 * 「いま話しているテーマ」を決めるための debounce 層。
 *
 * 音声認識の途中結果は 名古屋 → 名古屋城 → 名古屋城って … と激しく変わるので、
 * 同じ候補が一定時間トップであり続けたときだけ「確定トピック」として通知する。
 *  - 通常: 1.8秒 連続でトップ
 *  - 確定テキスト(final)に含まれていた場合: 0.9秒 に短縮（確度が高いので早く出す）
 * 一度確定したトピックは、別のトピックに移るまで再通知しない。
 */

const STABLE_MS = 1800;
const STABLE_MS_FINAL = 900;
const TICK_MS = 400;
/** 一度きりの短い語を弾く下限スコア（4文字の語を1回=2.0、2文字の語を1回=1.0 程度） */
const MIN_SCORE = 1.2;

interface Options {
  items: WindowedText[];
  active: boolean;
  /** 確定した主題と、次点以降の候補（主題が「調べる価値なし」だったときの代替） */
  onTopic: (term: string, alternatives: string[]) => void;
}

export interface TrackerState {
  /** いま様子見中の候補（UIで「検出中…」に使う） */
  pending: string | null;
  question: string | null;
  candidates: string[];
}

export function useTopicTracker({ items, active, onTopic }: Options): TrackerState {
  const [state, setState] = useState<TrackerState>({
    pending: null,
    question: null,
    candidates: [],
  });

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onTopicRef = useRef(onTopic);
  onTopicRef.current = onTopic;

  const pendingRef = useRef<{ term: string; since: number } | null>(null);
  const committedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      pendingRef.current = null;
      return;
    }
    const id = window.setInterval(() => {
      const now = Date.now();
      const guess = guessTopic(itemsRef.current, now);
      if (!guess) return;

      // スコアが低い＝一度きりの短い語。音声認識の誤りが多いので相手にしない
      if (guess.candidates[0].score < MIN_SCORE) return;

      const term = guess.term;
      if (pendingRef.current?.term !== term) {
        pendingRef.current = { term, since: now };
      }

      // その語が確定テキストに含まれていれば早く出す
      const inFinal = itemsRef.current.some(
        (it) => it.final && now - it.ts <= 20000 && it.text.includes(term),
      );
      const needed = inFinal ? STABLE_MS_FINAL : STABLE_MS;
      const heldFor = now - pendingRef.current.since;

      setState({
        pending: term,
        question: guess.question,
        candidates: guess.candidates.map((c) => c.term).slice(0, 5),
      });

      if (heldFor >= needed && committedRef.current !== term) {
        committedRef.current = term;
        onTopicRef.current(
          term,
          guess.candidates.map((c) => c.term).slice(0, 4),
        );
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);

  return state;
}
