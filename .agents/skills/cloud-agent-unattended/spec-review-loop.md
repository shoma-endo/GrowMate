# Cloud Agent: spec-review ループ

親: [`SKILL.md`](SKILL.md)。**`takt` は使わない。**

## 入口

ユーザー指示から `docs/plans/<slug>.md` を特定する。曖昧なら候補を列挙して **停止**（実装に進まない）。

## 手順（最大 3 周）

1. **identify** — `.takt/facets/instructions/spec-review/identify.md` に従い対象と適用観点を確定する。
2. **audit** — `.takt/facets/instructions/spec-review/audit.md` と `.agents/skills/spec-review/SKILL.md` に従う。
   - 外部サービスは公式ドキュメントを WebFetch で照合（不可なら「未実施」と明記）。
   - verdict: `approved` / `needs_fix` / `approved_with_questions`（後者はレビュー未完了）。
3. **revise**（`needs_fix` のとき）— `.takt/facets/instructions/spec-review/revise.md`。指摘を仕様書へ反映し audit に戻る。
4. **visualize**（`approved` のとき）— `.takt/facets/instructions/spec-review/visualize.md` と `spec-to-html`。
5. **finalize** — `.takt/facets/instructions/spec-review/finalize.md`。
   - メタデータ `- ステータス:` を `approved` へ（既に `approved` / `implemented` なら維持）。
   - **docs のみ** commit。新規ブランチ・push・PR はしない。
   - git 書き込み不可ならメタ更新まで行い、commit 未実施を報告して完了扱い（レビュー本体は成立）。

## 停止条件（完了にしない）

- 対象スコープに未解決のクライアント確認・実装判断・外部入力・承認ゲートが残る（`approved_with_questions`）
- audit↔revise が 3 周しても収束しない
- 修正方針を断定できない

停止時は仕様書に未確定事項を残し、最終応答に「回答反映後に Cloud Agent で再実行」と書く。**この状態で実装ループへ進まない。**

## 実装前ゲート

UI たたき台／UIモック CP が未承認でも finalize は可（仕様どおり）。ただし次の実装ループはゲート承認まで開始しない。

## 完了時の次アクション表記

- 未解決質問あり → 回答を仕様へ反映 → 本ループ再実行
- UI ゲート未承認 → PO 承認後に `spec-to-pr-loop`
- それ以外 → `spec-to-pr-loop`（または人間が push）
