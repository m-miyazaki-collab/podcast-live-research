import type { RecentEntry, TopicCard, TranscriptChunk } from '../types';

export function RelatedList({
  items,
  onOpen,
}: {
  items: string[];
  onOpen: (term: string) => void;
}) {
  return (
    <section className="panel related">
      <div className="panel-title">RELATED</div>
      {items.length === 0 ? (
        <p className="empty-text small">—</p>
      ) : (
        <div className="chip-row">
          {items.map((t) => (
            <button className="chip" key={t} onClick={() => onOpen(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecentList({
  items,
  activeTitle,
  onOpen,
}: {
  items: RecentEntry[];
  activeTitle: string | null;
  onOpen: (card: TopicCard) => void;
}) {
  return (
    <section className="panel recent">
      <div className="panel-title">RECENT</div>
      {items.length === 0 ? (
        <p className="empty-text small">—</p>
      ) : (
        <ul className="recent-list">
          {items.map((e) => (
            <li key={e.card.title}>
              <button
                className={`recent-item${e.card.title === activeTitle ? ' active' : ''}`}
                onClick={() => onOpen(e.card)}
              >
                {e.card.thumbnail ? (
                  <img className="recent-thumb" src={e.card.thumbnail} alt="" loading="lazy" />
                ) : (
                  <span className="recent-thumb recent-thumb-empty" />
                )}
                <span className="recent-title">{e.card.title}</span>
                <span className="recent-time">
                  {new Date(e.at).toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TranscriptPanel({
  finals,
  interim,
  showAll,
  onToggleShowAll,
}: {
  finals: TranscriptChunk[];
  interim: string;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const shown = showAll ? finals : finals.slice(-12);
  return (
    <section className="panel transcript">
      <div className="panel-title">
        TRANSCRIPT
        <button className="mini-btn" onClick={onToggleShowAll}>
          {showAll ? '直近のみ' : '全文'}
        </button>
      </div>
      <div className="transcript-body">
        {shown.length === 0 && !interim && <span className="empty-text small">—</span>}
        {shown.map((c) => (
          <span className="t-final" key={c.id}>
            {c.text}{' '}
          </span>
        ))}
        {interim && <span className="t-interim">{interim}</span>}
      </div>
    </section>
  );
}
