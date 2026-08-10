import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API (SpeechRecognition) ラッパー。
 *
 * iPadOS Safari の実挙動を前提にした作り:
 *  - webkit プレフィックス必須
 *  - continuous=true でも無音や一定時間で勝手に onend する → 自動再開する
 *  - start() は原則ユーザー操作起点で最初の1回を呼ぶ必要がある（許可ダイアログ）
 *  - バックグラウンドに回ると停止するので visibilitychange で復帰させる
 *  - ただし無限再起動ループは絶対に避ける（連続失敗でバックオフ→停止）
 */

export interface SpeechResult {
  transcript: string;
  isFinal: boolean;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isSpeechSupported = (): boolean => getCtor() !== null;

export type SpeechStatus = 'idle' | 'starting' | 'listening' | 'restarting' | 'error';

interface Options {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}

/** 短時間に何度も落ちるようなら諦める（無限ループ防止） */
const MAX_RESTARTS_IN_WINDOW = 12;
const RESTART_WINDOW_MS = 20000;

export function useSpeechRecognition({ lang = 'ja-JP', onFinal, onInterim }: Options) {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState<boolean>(() => isSpeechSupported());

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRunningRef = useRef(false);
  // start ↔ restart の相互参照を ref で断ち切る（古いクロージャを掴まないため）
  const scheduleRestartRef = useRef<() => void>(() => {});
  const restartTimesRef = useRef<number[]>([]);
  const restartTimerRef = useRef<number | null>(null);
  // コールバックは毎レンダー変わるので ref 経由で最新を参照する
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  // 致命的エラーの後に onend が来ても ERROR 表示を消さないためのフラグ
  const fatalRef = useRef(false);

  const fail = useCallback((message: string) => {
    wantRunningRef.current = false;
    fatalRef.current = true;
    clearRestartTimer();
    setStatus('error');
    setError(message);
  }, []);

  const createRecognition = useCallback((): SpeechRecognitionLike | null => {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setStatus('listening');
      setError(null);
    };

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (!text) continue;
        if (r.isFinal) onFinalRef.current(text.trim());
        else interim += text;
      }
      onInterimRef.current(interim.trim());
    };

    rec.onerror = (e) => {
      switch (e.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          fail(
            'マイクの使用が許可されていません。Safariの「あぁ」メニュー →「Webサイトの設定」→ マイク を「許可」にしてから再読み込みしてください。',
          );
          break;
        case 'audio-capture':
          fail('マイクが見つかりません。他のアプリがマイクを使っていないか確認してください。');
          break;
        case 'language-not-supported':
          fail(`この端末では音声認識の言語 ${lang} が利用できません。`);
          break;
        case 'no-speech':
        case 'aborted':
        case 'network':
        default:
          // 復帰可能なエラー。onend 側で再開する
          break;
      }
    };

    rec.onend = () => {
      recRef.current = null;
      if (!wantRunningRef.current) {
        if (!fatalRef.current) setStatus('idle');
        return;
      }
      scheduleRestartRef.current();
    };

    return rec;
  }, [fail, lang]);

  const startInternal = useCallback(() => {
    if (recRef.current) return;
    const rec = createRecognition();
    if (!rec) {
      fail('この端末/ブラウザは Web Speech API（音声認識）に対応していません。');
      return;
    }
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // すでに開始済みの InvalidStateError 等。少し待って再試行
      recRef.current = null;
      scheduleRestartRef.current();
    }
  }, [createRecognition, fail]);

  const scheduleRestart = useCallback(() => {
    if (!wantRunningRef.current || restartTimerRef.current !== null) return;

    const now = Date.now();
    const times = restartTimesRef.current.filter((t) => now - t < RESTART_WINDOW_MS);
    times.push(now);
    restartTimesRef.current = times;

    if (times.length > MAX_RESTARTS_IN_WINDOW) {
      fail('音声認識が繰り返し停止しました。STARTを押し直してください。');
      return;
    }

    // 連続失敗するほど間隔を空ける（250ms → 最大4秒）
    const delay = Math.min(250 * Math.pow(1.6, Math.max(0, times.length - 1)), 4000);
    setStatus('restarting');
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (wantRunningRef.current) startInternal();
    }, delay);
  }, [fail, startInternal]);

  scheduleRestartRef.current = scheduleRestart;

  const start = useCallback(() => {
    if (!supported) {
      fail(
        'この端末/ブラウザは音声認識(Web Speech API)に対応していません。iPadOS 14.5以降のSafari、またはChromeでお試しください。',
      );
      return;
    }
    setError(null);
    fatalRef.current = false;
    restartTimesRef.current = [];
    wantRunningRef.current = true;
    setStatus('starting');
    startInternal();
  }, [fail, startInternal, supported]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    clearRestartTimer();
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.stop();
    } catch {
      /* 既に止まっている */
    }
    setStatus('idle');
  }, []);

  // バックグラウンド復帰時の取りこぼしを拾う（iPadでは高確率で止まる）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantRunningRef.current && !recRef.current) {
        restartTimesRef.current = []; // 復帰時はカウンタをリセット
        scheduleRestart();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [scheduleRestart]);

  useEffect(() => {
    return () => {
      wantRunningRef.current = false;
      clearRestartTimer();
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  return { status, error, supported, start, stop, running: status !== 'idle' && status !== 'error' };
}
