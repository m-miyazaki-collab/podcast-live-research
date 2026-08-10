import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { NowCard } from './components/NowCard';
import { RecentList, RelatedList, TranscriptPanel } from './components/SidePanels';
import { SettingsDialog } from './components/SettingsDialog';
import { AiPanel } from './components/AiPanel';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTopicTracker } from './hooks/useTopicTracker';
import { getCachedCard, isKnownMiss, NotFoundError, researchTopic } from './lib/research';
import { cacheGet, cacheSet } from './lib/cache';
import { autoSearchLimiter } from './lib/rateLimit';
import { askAi, isAiEnabled } from './lib/ai';
import type { ResearchState, TopicCard, TranscriptChunk } from './types';
import type { WindowedText } from './lib/topic';

/** トピック検出に使う会話の窓（秒）。Transcript自体は全部保持する */
const TOPIC_WINDOW_MS = 120000;
const RECENT_MAX = 10;
const RECENT_TTL = 1000 * 60 * 60 * 24 * 7;

let chunkSeq = 0;

export default function App() {
  const [finals, setFinals] = useState<TranscriptChunk[]>([]);
  const [interim, setInterim] = useState('');
  const [research, setResearch] = useState<ResearchState>({ status: 'idle' });
  // リロードしてもRECENTが残るように、履歴もキャッシュに置く
  const [recent, setRecent] = useState<TopicCard[]>(
    () => cacheGet<TopicCard[]>('recent', RECENT_TTL) ?? [],
  );
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
      .filter((c) => now - c.ts <= TOPIC_WINDOW_MS)
      .map((c) => ({ text: c.text, ts: c.ts, final: true }));
    if (interim) items.push({ text: interim, ts: interimTs, final: false });
    return items;
  }, [finals, interim, interimTs]);

  const openTopic = useCallback(async (query: string, manual: boolean) => {
    const cached = getCachedCard(query);
    if (cached) {
      setResearch({ status: 'ready', card: cached });
      pushRecent(setRecent, cached);
      return;
    }
    if (!manual) {
      if (isKnownMiss(query)) return;
      if (!autoSearchLimiter.allow()) {
        setRateLimited(true);
        return;
      }
      setRateLimited(false);
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setResearch({ status: 'loading', query });
    try {
      const card = await researchTopic(query, ac.signal);
      if (ac.signal.aborted) return;
      setResearch({ status: 'ready', card });
      pushRecent(setRecent, card);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof NotFoundError) {
        // 自動検出のミスは画面を汚さない（手動タップのときだけ知らせる）
        if (manual) setResearch({ status: 'notfound', query });
        else if (researchRef.current.status === 'loading') {
          setResearch(researchRef.current.query === query ? { status: 'idle' } : researchRef.current);
        }
        return;
      }
      setResearch({
        status: 'error',
        query,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const onTopicDetected = useCallback(
    (term: string) => {
      const cur = researchRef.current;
      if (cur.status === 'ready' && (cur.card.title === term || cur.card.query === term)) return;
      if (cur.status === 'loading' && cur.query === term) return;
      void openTopic(term, false);
    },
    [openTopic],
  );

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
            onRetry={(q) => void openTopic(q, true)}
          />
          <AiPanel
            open={aiOpen}
            loading={aiLoading}
            result={aiResult}
            error={aiError}
            onClose={() => setAiOpen(false)}
          />
          <RelatedList
            items={nowCard?.related ?? []}
            onOpen={(t) => void openTopic(t, true)}
          />
        </div>

        <div className="col-side">
          <RecentList
            items={recent}
            activeTitle={nowCard?.title ?? null}
            onOpen={(c) => setResearch({ status: 'ready', card: c })}
          />
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
                  <button className="chip small" key={t} onClick={() => void openTopic(t, true)}>
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

function pushRecent(
  setRecent: React.Dispatch<React.SetStateAction<TopicCard[]>>,
  card: TopicCard,
) {
  setRecent((prev) => [card, ...prev.filter((c) => c.title !== card.title)].slice(0, RECENT_MAX));
}
