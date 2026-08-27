# Cloud Agent: 実装 → PR ループ

親: [`SKILL.md`](SKILL.md)。**`takt` は使わない。** 前提は `spec-review-loop` 完了（または同等の `approved`）。

## 入口ゲート（欠けたら停止）

`.takt/facets/instructions/spec-to-pr/plan.md` と同じ:

1. メタデータ `- ステータス:` が `approved` または `implemented`
2. 対象スコープに未解決のクライアント確認・実装判断・外部入力・承認ゲートが無い
3. UI が対象かつ UIモック／たたき台ゲートがあるなら承認済み（UI 対象外なら不要）

欠ける場合は実装せず、仕様修正またはゲート承認を次アクションに残す。

## 手順

1. **plan** — `spec-to-pr/plan.md`。必須ヘッダ（対象仕様書 / ステータス / 対象スコープ / UIモック）を守る。レポートファイルを必須にしないが、同等の内容を作業メモまたは最終応答に残す。
2. **implement** — `spec-to-pr/implement.md` + 該当 Skills。スコープ外の「ついで修正」禁止。
3. **verify** — プロダクション影響パス変更時のみ `npm run verify` または `verify:changed`。
4. **reviewers（最大 3 周）** — AI アンチパターン + アーキテクチャ相当を `spec-to-pr` の review 指示に沿って実施 → fix。`cannot_fix` / 方針差分のみなら抜ける。空回りなら停止。
5. **readme_sync** — `spec-to-pr/readme-sync.md`（必要なときだけ）。
6. **self_review** — `quality-gate` + `spec-to-pr/self-review.md`。手動ブラウザ等は未確認事項へ。
7. **PR** — `spec-to-pr/create-pr.md` の意図を踏まえつつ Cloud では次を優先:
   - ブランチ: 環境が要求する `cursor/...` 形式を使う（ローカル TAKT の `feature/*` 固定に無理に合わせない）
   - push 後、`ManagePullRequest` で draft PR を作成または更新（使えなければ `gh`）
   - base は `develop`（リポジトリ既定に従う）
   - `@codex` レビュー依頼コメントは投稿しない
   - merge / close しない

## 停止条件

- 仕様不足・スコープ逸脱が実装中に発覚 → 推測補完せず停止。仕様を直してから再実行
- review / self_review が 3 周しても非生産的 → 停止し残件を PR または応答に残す
- git 書き込み不可 → commit/push/PR をループしない。残差分を報告

## 完了条件

- 対象スコープの実装が仕様に対応している
- 必須 verify が通っている（対象外変更のみならスキップ理由を書く）
- draft PR が作成または更新されている（権限で不可ならその旨）
- 未確認事項（手動 UI・実 API・migration 適用等）が PR 本文または応答に列挙されている
