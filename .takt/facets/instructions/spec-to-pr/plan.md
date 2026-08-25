`docs/plans/` の仕様書を起点に、GrowMate の実装計画を作成してください。

{{include:instructions/unattended-operation}}

運用前提（このステップ固有）:
- 人間の介在点は `docs/plans/` の仕様確定のみ。
- 実装開始の前提は次をすべて満たすこと。(1) 対象仕様書メタデータの `- ステータス:` が `approved` または `implemented`。(2) `spec-review` が対象スコープの未解決質問・実装判断・外部入力・承認ゲートなしで approved 完了していること。(3) **UI 実装が対象範囲に含まれ、かつ**仕様に UI たたき台／UIモックの実装前ゲート（例: CP-2）がある場合に限り、そのゲートが承認済みであること。UI 無し・ゲート無しでは (3) は適用しない（満たしたものとして扱う）。欠ける場合は実装に進まず ABORT し、人間が仕様書を直して `spec-review` から再実行する（またはたたき台を承認する）前提の確認事項を残す。

必須出力ヘッダ（後段ステップの正本。欠落・複数パス・曖昧表記は不可）:
- 位置: `# タスク計画` の直後、`## 元の要求` の前（output contract `spec-to-pr/plan` と同じ）。ファイル先頭の `# タスク計画` より上や、分析本文の途中に置かない。
- 形式（キー名・順序固定）:
```
対象仕様書: docs/plans/<slug>.md
ステータス: approved|implemented
対象スコープ: <本ランの実装範囲。例: フェーズ0+1 / 全文。Non-goals は書かない>
UIモック: 対象外|なし|あり（ゲート: なし|承認済み）
```
- `対象仕様書:` はリポジトリ相対パス1行・1件のみ。本文転記や候補列挙はしない。
- 後段は当該パスの現行ファイルを読む。`docs/plans/` の列挙・推測で対象を決めてはならない。

必須手順:
1. ユーザー指示から対象仕様書を特定する。曖昧な場合は `docs/plans/` を列挙し、候補を示して ABORT する。
2. 対象仕様書のメタデータ `- ステータス:` を確認する（必須ゲート）:
   - 許可値は `approved` または `implemented` のみ。`docs/templates/requirement-definition.md` の形式（`- ステータス: ...`）を読む。
   - `draft` / `review` / 空欄 / 行欠損 / 表記ゆれは **ABORT**。レビュー記録や本文の「approved」表記だけでは代用しない。
   - `implemented` は再実行・差分追記を許容するため通過可。新規着手の正規は `approved`（`spec-review` finalize が更新する）。
   - 確認した値を必須出力ヘッダの `ステータス:` に書く。
3. UI たたき台／UIモックのゲートを確認する:
   - **UI が対象範囲に含まれない**（画面・コンポーネント変更が Non-goals または対象外）場合: ゲート確認は不要。必須出力ヘッダの `UIモック:` に `対象外` と書く。
   - UI が対象のときのみ以下を見る:
     - 仕様書のチェックポイント・承認表・未確定事項に「UIたたき台」「UIモック」「画面たたき台」等の実装前ゲートがあり、状態が未確認／未承認なら **ABORT**。仕様本文の画面設計だけ揃っていても代用しない。
     - ゲートがあるのに図解バンドルに UIモックが無い（`docs/plans/_html/<slug>/views/06-ui-mock.html` または結合 HTML の「UIモック」タブが無い）場合も **ABORT**。先に `.agents/skills/spec-to-html/SKILL.md` に従い `06-ui-mock.html` を追加して `build` し、人間が承認する。
     - ゲートが無い、または承認済みなら通過。必須出力ヘッダの `UIモック:` に `なし` または `あり（ゲート: なし|承認済み）` を書く。
     - UIモックがある場合、見た目・文言・状態別UIの実装正本は **UIモック**（次点で仕様 §画面設計）。ASCII レイアウトや推測でモックを上書きする計画は禁止。
4. 必須出力ヘッダの `対象仕様書:` パスの現行ファイル、`AGENTS.md`、`.takt/facets/knowledge/growmate.md`、`.agents/skills/implementation-guidelines/SKILL.md` を読む。UIモックがある場合は `docs/plans/_html/<slug>.html` の UIモックタブ（または `views/06-ui-mock.html`）も読む。
5. Server Actions / Route Handlers / Zod / エラー処理が関わる場合は `.agents/skills/nextjs-server/SKILL.md` を読む。
6. UI 実装が関わる場合は `.agents/skills/growmate-ui-ux/SKILL.md` と `.agents/skills/react/SKILL.md` を読む。
7. Supabase / migration / RLS / Service Role が関わる場合は `.agents/skills/supabase/SKILL.md` を読む。
8. 再実行 / 途中再開の現状を確認する（新規一発前提で計画しない）:
   - 現在ブランチ、`git status`、未コミット差分の有無。
   - 対象仕様に対応しそうな既存リモートブランチ（`feature/*` / `fix/*`）と、その open PR（`gh pr list`）。
   - 既存 WIP / 既存 PR がある場合は「差分追記」計画にし、ゼロからの作り直しを避ける。前回までの経緯は既存ブランチの差分・PR 本文・対象仕様書から把握する（`.takt/runs/` 配下は探索しない）。
9. 仕様要件と現行コード（および既存 WIP）の差分、変更対象、検証方法、PR本文に記載すべき関連仕様書を整理する。仕様書の対象範囲と Non-goals から実装許可範囲を定義し、本ランの範囲を必須出力ヘッダの `対象スコープ:` に1行で書く。対象外の画面・UI・機能・改善を `plan.md` に含めない。
   - UI がある場合、計画の画面差分は UIモック（あれば）と仕様の画面設計に対応づけて書く。
   - 純粋関数、境界値・分岐の多いロジック、正規化・集計・日付処理、分離済みZodスキーマ、既知バグの回帰に関わる場合は `docs/specs/testing-strategy.md` を読み、追加・更新するVitestケースと期待結果を計画に含める。
   - UIコンポーネント、外部API、Supabase / RLS / RPC、LLM出力そのものは同戦略の自動テスト対象外として扱い、仕様書または手動確認へ振り分ける。
10. 対象仕様書内の spec-review 反映内容を取り込む（spec-review workflow はレビュー結果を仕様書本体の「レビュー記録」「未確定事項（クライアント確認中）」セクションに記録する。`.takt/runs/` 配下は探索しない）:
   - これらのセクションが無い場合はブロックしないが、計画レポートに「spec-review 記録なし」と明記する。
   - 記録がある場合、**理由付きで残置合意された指摘（approved の 🟡 残置）を `plan.md` に転記する**。後段の `review` が同じ論点を再指摘して review -> fix ループを空回りさせないため。`approved_with_questions` はレビュー未完了なので、対象スコープの未解決質問・実装判断・外部入力・承認ゲートがあれば ABORT する。
   - 仕様書に「公式ドキュメント照合: 未実施」と記録されている場合、その旨を `plan.md` に明記する（実装時に前提が未検証であることを PR の未確認事項へ回すため）。
11. 仕様が新規マイグレーション（新規テーブル・新規列）を要求し、それがまだリモートDBに未適用（`database.types.ts` に反映されていない）場合、これ単体は ABORT 理由にしない。`.agents/skills/supabase/service-usage.md` §6 の Pending Migration Types パターン（`src/types/database.types.pending.ts` + `asPendingClient()`）を計画に含め、最後まで実装する前提で進める。リモートへの適用と `npm run supabase:types` は管理者が本PRマージ後に行う運用とし、完了条件にしない。
12. `plan.md` は `# タスク計画` 直後に必須出力ヘッダを置き、本文は要点のみに絞る（上限目安 15KB）。仕様書・レビュー記録・既存コードは本文を転記せず、章番号・行番号・パスで参照する。`plan.md` は後段の implement / review / self_review / prepare_pr_summary へ全文添付されるため、肥大がそのまま全ステップの入力コストになる。
