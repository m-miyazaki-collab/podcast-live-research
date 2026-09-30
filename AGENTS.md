# Contributor guidance

この公開プロジェクトの目的、構成、実行例は [README.md](README.md) が正本です。作業前に README と変更対象にリンクされた公開資料を読みます。

- リポジトリのルートで `git rev-parse --show-toplevel`、`git branch --show-current`、`git status --short` を確認する。共有ブランチは `main`。
- GitHub の `origin` を共有ソースとし、作業前に `git fetch origin` 後 `git rev-list --left-right --count origin/main...HEAD` で同期状態を確認する。予期しない差分は統合せず報告する。
- パスはリポジトリルートからの相対パスで扱う。既存の未コミット変更・staged変更を保存し、`git add -A` は使わない。
- `src/`、`public/`、`scripts/`、`package.json` は GitHub の公開コードと設定。ブラウザの文字起こしは端末上で扱い、API キーを使う任意機能のキーは localStorage または外部の実行環境で管理し、表示・コピー・Git 登録しない。
- データや公開設定を変更する前に、現在の状態と README の説明を確認する。削除・公開反映などの外部操作は現在状態、バックアップ、明示的な承認をそろえる。文書作業の依頼はデプロイを承認しない。
- 変更は自分が所有する文書だけを stage してコミットし、同じブランチへ push する。完了時に `git rev-list --left-right --count origin/main...HEAD` の `0 0` と、実行したコマンド・出力を報告する。実行できない検証は「未検証」と明記する。

この公開リポジトリの文書には、非公開のアカウント、ローカル絶対パス、顧客情報、非公開リポジトリや運用ノートへの参照を書きません。
