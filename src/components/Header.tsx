import type { SpeechStatus } from '../hooks/useSpeechRecognition';

interface Props {
  status: SpeechStatus;
  running: boolean;
  pending: string | null;
  cacheOnly: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

const STATUS_LABEL: Record<SpeechStatus, string> = {
  idle: 'STANDBY',
  starting: 'STARTING',
  listening: 'LISTENING',
  restarting: 'RECONNECTING',
  error: 'ERROR',
};

export function Header({
  status,
  running,
  pending,
  cacheOnly,
  onStart,
  onStop,
  onOpenSettings,
}: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="brand">PODCAST LIVE RESEARCH</h1>
        <div className={`status status-${status}`}>
          <span className="dot" />
          {STATUS_LABEL[status]}
        </div>
        {pending && running && (
          <div className="pending" title="検出中のトピック候補">
            DETECTING: <b>{pending}</b>
          </div>
        )}
        {cacheOnly && <div className="warn-pill">レート制限中（キャッシュのみ）</div>}
      </div>
      <div className="header-right">
        <button className="btn btn-ghost" onClick={onOpenSettings} aria-label="設定">
          設定
        </button>
        {running ? (
          <button className="btn btn-stop" onClick={onStop}>
            STOP
          </button>
        ) : (
          <button className="btn btn-start" onClick={onStart}>
            収録開始 / START
          </button>
        )}
      </div>
    </header>
  );
}
