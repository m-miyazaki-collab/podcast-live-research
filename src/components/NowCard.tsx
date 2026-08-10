import type { ResearchState } from '../types';

interface Props {
  state: ResearchState;
  question: string | null;
  aiEnabled: boolean;
  onAskAi: () => void;
  onRetry: (query: string) => void;
}

export function NowCard({ state, question, aiEnabled, onAskAi, onRetry }: Props) {
  if (state.status === 'idle') {
    return (
      <section className="panel now now-empty">
        <div className="panel-title">NOW</div>
        <p className="empty-text">
          STARTを押して話し始めてください。
          <br />
          会話から固有名詞を検出すると、ここに情報カードが出ます。
        </p>
      </section>
    );
  }

  if (state.status === 'loading') {
    return (
      <section className="panel now">
        <div className="panel-title">NOW</div>
        <h2 className="now-title">{state.query}</h2>
        <p className="loading-text">検索中…</p>
      </section>
    );
  }

  if (state.status === 'notfound') {
    return (
      <section className="panel now">
        <div className="panel-title">NOW</div>
        <h2 className="now-title dim">{state.query}</h2>
        <p className="empty-text">Wikipediaに該当記事が見つかりませんでした。</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="panel now">
        <div className="panel-title">NOW</div>
        <h2 className="now-title dim">{state.query}</h2>
        <p className="error-text">取得に失敗しました: {state.message}</p>
        <button className="btn btn-ghost" onClick={() => onRetry(state.query)}>
          再試行
        </button>
      </section>
    );
  }

  const { card } = state;
  return (
    <section className="panel now">
      <div className="panel-title">
        NOW
        {question && <span className="question-chip">Q: {question}</span>}
      </div>

      <h2 className="now-title">{card.title}</h2>
      {card.description && <div className="now-desc">{card.description}</div>}

      <p className="now-summary">{card.summary}</p>

      {card.facts.length > 0 && (
        <dl className="facts">
          {card.facts.map((f) => (
            <div className="fact" key={f.label + f.value}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="now-actions">
        <a className="btn btn-link" href={card.wikipediaUrl} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
        {card.wikidataUrl && (
          <a className="btn btn-link" href={card.wikidataUrl} target="_blank" rel="noreferrer">
            Wikidata
          </a>
        )}
        <button
          className="btn btn-ai"
          onClick={onAskAi}
          disabled={!aiEnabled}
          title={aiEnabled ? 'AIに聞く' : '設定でAPIキーを登録すると使えます（任意・課金あり）'}
        >
          AIで調べる
        </button>
      </div>
      <div className="source-note">
        出典: ja.wikipedia.org / wikidata.org（{new Date(card.fetchedAt).toLocaleTimeString('ja-JP')}
        取得）
      </div>
    </section>
  );
}
