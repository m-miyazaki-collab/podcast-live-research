interface Props {
  open: boolean;
  loading: boolean;
  result: string | null;
  error: string | null;
  onClose: () => void;
}

/** 「AIで調べる」の結果表示。AI未設定なら開かない。 */
export function AiPanel({ open, loading, result, error, onClose }: Props) {
  if (!open) return null;
  return (
    <section className="panel ai-panel">
      <div className="panel-title">
        AI RESEARCH
        <button className="mini-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      {loading && <p className="loading-text">問い合わせ中…</p>}
      {error && <p className="error-text">{error}</p>}
      {result && <pre className="ai-text">{result}</pre>}
    </section>
  );
}
