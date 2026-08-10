#!/usr/bin/env bash
# dist/ をビルドして gh-pages ブランチに公開する。
#   使い方: npm run deploy
# 公開先: https://<GitHubユーザー名>.github.io/podcast-live-research/
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_URL="$(git remote get-url origin)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

npm run build
touch dist/.nojekyll
cp -R dist/. "$TMP/"

cd "$TMP"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy: $(date '+%Y-%m-%d %H:%M')"
git remote add origin "$REMOTE_URL"
git push -f -q origin gh-pages

echo "✅ deployed. 反映まで1〜2分かかることがあります。"
