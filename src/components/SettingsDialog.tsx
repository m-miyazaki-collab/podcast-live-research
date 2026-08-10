import { useState } from 'react';
import { DEFAULT_AI_CONFIG, loadAiConfig, saveAiConfig, type AiConfig } from '../lib/ai';
import { clearCache } from '../lib/cache';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

/**
 * AIは「任意の追加機能」。ここで登録しない限りアプリは完全に無料APIのみで動く。
 * APIキーはこの端末の localStorage にだけ保存し、コードには一切埋め込まない。
 */
export function SettingsDialog({ onClose, onChanged }: Props) {
  const [config, setConfig] = useState<AiConfig>(() => loadAiConfig() ?? DEFAULT_AI_CONFIG);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<AiConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setSaved(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        <h3>AI（任意）</h3>
        <p className="note">
          未設定でもアプリは動きます（Wikipedia / Wikidata のみ・完全無料）。
          ここに登録した場合だけ「AIで調べる」ボタンが有効になり、押したときだけ課金が発生します。
          キーはこの端末のブラウザにのみ保存されます。
        </p>

        <label>
          プロバイダ
          <select
            value={config.provider}
            onChange={(e) => update({ provider: e.target.value as AiConfig['provider'] })}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai-compatible">OpenAI互換 / 自前プロキシ</option>
          </select>
        </label>

        <label>
          モデル
          <input
            type="text"
            value={config.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="claude-sonnet-5"
          />
        </label>

        <label>
          エンドポイント（空欄なら既定）
          <input
            type="text"
            value={config.endpoint ?? ''}
            onChange={(e) => update({ endpoint: e.target.value })}
            placeholder={
              config.provider === 'anthropic'
                ? 'https://api.anthropic.com/v1/messages'
                : '/api/chat'
            }
          />
        </label>

        <label>
          APIキー
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="未入力ならAI機能は無効"
            autoComplete="off"
          />
        </label>

        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              saveAiConfig(null);
              setConfig(DEFAULT_AI_CONFIG);
              setSaved(true);
              onChanged();
            }}
          >
            AI設定を削除
          </button>
          <button
            className="btn btn-start"
            onClick={() => {
              saveAiConfig(config.apiKey ? config : null);
              setSaved(true);
              onChanged();
            }}
          >
            保存
          </button>
        </div>
        {saved && <p className="note ok">保存しました。</p>}

        <h3>キャッシュ</h3>
        <p className="note">
          取得済みの情報カードは端末内に7日間保存され、同じトピックは再取得しません。
        </p>
        <button
          className="btn btn-ghost"
          onClick={() => {
            clearCache();
            setSaved(false);
          }}
        >
          キャッシュを消去
        </button>

        <div className="modal-actions">
          <button className="btn btn-stop" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
