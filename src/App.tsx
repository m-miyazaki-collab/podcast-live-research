import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { NowCard } from './components/NowCard';
import { RecentList, RelatedList, TranscriptPanel } from './components/SidePanels';
import { SettingsDialog } from './components/SettingsDialog';
import { AiPanel } from './components/AiPanel';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTopicTracker } from './hooks/useTopicTracker';
import {
  getCachedCard,
  isKnownMiss,
  isSubstantial,
  isThin,
  markThin,
  NotFoundError,
  researchTopic,
} from './lib/research';
import { cacheGet, cacheSet } from './lib/cache';
import { autoSearchLimiter } from './lib/rateLimit';
import { askAi, isAiEnabled } from './lib/ai';
import type { RecentEntry, ResearchState, TopicCard, TranscriptChunk } from './types';
import type { WindowedText } from './lib/topic';

/** トピック検出に渡す会話の量。Transcript自体は全部保持する */
const TRANSCRIPT_FEED_MS = 120000;
const RECENT_MAX = 10;
const RECENT_TTL = 1000 * 60 * 60 * 24 * 7;

let chunkSeq = 0;

export default function App() {
  const [finals, setFinals] = useState<TranscriptChunk[]>([]);
  const [interim, setInterim] = useState('');
  const [research, setResearch] = useState<ResearchState>({ status: 'idle' });
  // リロードしてもRECENTが残るように、履歴もキャッシュに置く
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());
  const [showAllTranscript, setShowAllTranscript] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(() => isAiEnabled());
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const researchRef = useRef<ResearchState>(research);
  researchRef.current = research;
  /** 「候補を試したが全部ダメ」のときに戻す先（画面を空にしない） */
  const lastReadyRef = useRef<ResearchState>({ status: 'idle' });

  /** カードを表示し、RECENTの先頭に積む */
  const showCard = useCallback((card: TopicCard) => {
    const state: ResearchState = { status: 'ready', card };
    lastReadyRef.current = state;
    setResearch(state);
    setRecent((prev) =>
      [{ card, at: Date.now() }, ...prev.filter((e) => e.card.title !== card.title)].slice(
        0,
        RECENT_MAX,
      ),
    );
  }, []);

  // ---- 音声認識 ------------------------------------------------------------
  const handleFinal = useCallback((text: string) => {
    if (!text) return;
    setFinals((prev) => [...prev, { id: `c${chunkSeq++}`, text, final: true, ts: Date.now() }]);
    setInterim('');
  }, []);

  const speech = useSpeechRecognition({
    lang: 'ja-JP',
    onFinal: handleFinal,
    onInterim: setInterim,
  });

  // ---- トピック検出（debounce付き）----------------------------------------
  const [interimTs, setInterimTs] = useState(Date.now());
  useEffect(() => {
    setInterimTs(Date.now());
  }, [interim]);

  const windowItems: WindowedText[] = useMemo(() => {
    const now = Date.now();
    const items: WindowedText[] = finals
      .filter((c) => now - c.ts <= TRANSCRIPT_FEED_MS)
      .map((c) => ({ text: c.text, ts: c.ts, final: true }));
    if (interim) items.push({ text: interim, ts: interimTs, final: false });
    return items;
  }, [finals, interim, interimTs]);

  /** ユーザーが自分でタップしたとき: 制限も内容チェックもせず必ず表示する */
  const openTopic = useCallback(async (query: string) => {
    const cached = getCachedCard(query);
    if (cached) {
      showCard(cached);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setResearch({ status: 'loading', query });
    try {
      const card = await researchTopic(query, ac.signal);
      if (ac.signal.aborted) return;
      showCard(card);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof NotFoundError) {
        setResearch({ status: 'notfound', query });
        return;
      }
      setResearch({
        status: 'error',
        query,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [showCard]);

  /**
   * 会話から自動検出したとき。
   * 上位候補を順に試し、「中身のあるカード」が出た時点で採用する。
   * 「自転車」「ヘッドフォン」のような一般名詞は捨てて次の候補へ回す。
   */
  const onTopicDetected = useCallback(async (term: string, alternatives: string[]) => {
    const queue = [term, ...alternatives.filter((t) => t !== term)].slice(0, 4);

    for (const q of queue) {
      const cur = researchRef.current;
      if (cur.status === 'ready' && (cur.card.title === q || cur.card.query === q)) return;
      if (isKnownMiss(q) || isThin(q)) continue;

      const cached = getCachedCard(q);
      if (cached) {
        if (isSubstantial(cached)) {
          showCard(cached);
          return;
        }
        markThin(q);
        continue;
      }

      if (!autoSearchLimiter.allow()) {
        setRateLimited(true);
        return;
      }
      setRateLimited(false);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setResearch({ status: 'loading', query: q });
      try {
        const card = await researchTopic(q, ac.signal);
        if (ac.signal.aborted) return;
        if (isSubstantial(card)) {
          showCard(card);
          return;
        }
        // 記事はあったが「誰でも知っていること」だった → 次の候補へ
        markThin(q);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (!(e instanceof NotFoundError)) {
          setResearch({ status: 'error', query: q, message: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
    }

    // どれも採用できなかった: 直前のカードを消さずにそのまま残す
    if (researchRef.current.status === 'loading') setResearch(lastReadyRef.current);
  }, [showCard]);

  const tracker = useTopicTracker({
    items: windowItems,
    active: speech.running,
    onTopic: onTopicDetected,
  });

  // ---- AI（任意・押したときだけ）------------------------------------------
  const recentTranscript = useMemo(() => {
    const now = Date.now();
    return finals
      .filter((c) => now - c.ts <= 60000)
      .map((c) => c.text)
      .join(' ');
  }, [finals]);

  const handleAskAi = useCallback(async () => {
    setAiOpen(true);
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const cur = researchRef.current;
      const res = await askAi({
        task: 'answer',
        topic: cur.status === 'ready' ? cur.card : null,
        transcript: recentTranscript,
        question: tracker.question ?? undefined,
      });
      setAiResult(res.text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }, [recentTranscript, tracker.question]);

  // 収録中は画面を消さない（対応端末のみ。非対応でも無害）
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (speech.running && nav.wakeLock) {
      nav.wakeLock
        .request('screen')
        .then((l) => {
          lock = l;
        })
        .catch(() => undefined);
    }
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, [speech.running]);

  useEffect(() => {
    cacheSet('recent', recent);
  }, [recent]);

  const nowCard = research.status === 'ready' ? research.card : null;

  return (
    <div className="app">
      <Header
        status={speech.status}
        running={speech.running}
        pending={tracker.pending}
        cacheOnly={rateLimited}
        onStart={speech.start}
        onStop={speech.stop}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {speech.error && <div className="banner error">{speech.error}</div>}
      {!speech.supported && (
        <div className="banner error">
          このブラウザは音声認識(Web Speech API)に対応していません。iPadOSのSafari、またはmacOS/AndroidのChromeで開いてください。
        </div>
      )}

      <main className="layout">
        <div className="col-main">
          <NowCard
            state={research}
            question={tracker.question}
            aiEnabled={aiEnabled}
            onAskAi={handleAskAi}
            onRetry={(q) => void openTopic(q)}
          />
          <AiPanel
            open={aiOpen}
            loading={aiLoading}
            result={aiResult}
            error={aiError}
            onClose={() => setAiOpen(false)}
          />
          <RelatedList items={nowCard?.related ?? []} onOpen={(t) => void openTopic(t)} />
        </div>

        <div className="col-side">
          <RecentList items={recent} activeTitle={nowCard?.title ?? null} onOpen={showCard} />
          <TranscriptPanel
            finals={finals}
            interim={interim}
            showAll={showAllTranscript}
            onToggleShowAll={() => setShowAllTranscript((v) => !v)}
          />
          {tracker.candidates.length > 0 && (
            <section className="panel candidates">
              <div className="panel-title">CANDIDATES</div>
              <div className="chip-row">
                {tracker.candidates.map((t) => (
                  <button className="chip small" key={t} onClick={() => void openTopic(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onChanged={() => setAiEnabled(isAiEnabled())}
        />
      )}
    </div>
  );
}

/** 保存済みのRECENT（古い形式が残っていても壊れないように検証してから使う） */
function loadRecent(): RecentEntry[] {
  const raw = cacheGet<unknown>('recent', RECENT_TTL);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is RecentEntry =>
      !!e && typeof e === 'object' && 'card' in e && !!(e as RecentEntry).card?.title,
  );
}
