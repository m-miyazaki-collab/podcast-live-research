import { findAnswer } from '../lib/answer';
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
    // 確定した情報ではないので、大見出しにはしない（誤検出をそれらしく見せない）
    return (
      <section className="panel now">
        <div className="panel-title">NOW</div>
        <p className="loading-text">「{state.query}」を検索中…</p>
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
  // 質問に対応する事実があれば、それを答えとして最上段に出す
  const answer = findAnswer(question, card.facts);
  return (
    <section className="panel now">
      <div className="panel-title">
        NOW
        {question && <span className="question-chip">Q: {question}</span>}
      </div>

      <h2 className="now-title">{card.title}</h2>
      {card.description && <div className="now-desc">{card.description}</div>}

      {answer && (
        <div className="answer">
          <span className="answer-label">{answer.fact.label}</span>
          <span className="answer-value">{answer.fact.value}</span>
        </div>
      )}

      {/* 概要と画像を横並びに。画像は「一瞬見て何の話かわかる」ための主役のひとつ */}
      <div className="now-lead">
        <p className="now-summary">{card.summary}</p>

        {card.thumbnail && (
          <figure className="now-figure">
            {/* 画像はWikipedia/Wikimedia Commonsのもの。タップで元ページを開く */}
            <a href={card.wikipediaUrl} target="_blank" rel="noreferrer">
              <img src={card.thumbnail} alt={card.title} loading="lazy" decoding="async" />
            </a>
            <figcaption>画像: Wikimedia Commons</figcaption>
          </figure>
        )}
      </div>

      {card.facts.length > 0 && (
        <dl className="facts">
          {card.facts.map((f) => (
            <div className="fact" key={f.label + f.value}>
              <dt>{f.label}</dt>
              <dd>
                {/^https?:\/\//.test(f.value) ? (
                  <a href={f.value} target="_blank" rel="noreferrer">
                    {f.value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                ) : (
                  f.value
                )}
              </dd>
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
