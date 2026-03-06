# GSC初回評価の無効化 仕様書

## 目的

GSCコンテンツ評価機能の初回評価を「ベースライン記録のみ」に変更し、無意味な改善提案の生成を防止する。

## 背景・課題

コンテンツ（記事）をGSC評価に登録した際、初回の評価実行時に「前回の順位」が存在しないにもかかわらず改善提案が生成される。100記事を登録すると100件の改善提案が出るが、比較対象がないため評価としての意義がない。

初回は「基準値（ベースライン）の記録」であり、「次回にどう変化したか」が本来の評価。

## 現状の動作（変更前）

### 初回評価の処理フロー

```
1. last_seen_position = NULL（初回のため前回順位なし）
2. judgeOutcome(null, currentPos) → 'no_change'
3. current_suggestion_stage: 1 → 2 に進展
4. gsc_article_evaluation_history にレコード挿入（outcome='no_change'）
5. gscSuggestionService.generate() 呼び出し → Claude API で改善提案生成 ← 問題
6. 未読通知として表示される ← 問題
```

### 問題箇所

`src/server/services/gscEvaluationService.ts` L364:

```typescript
// outcome='no_change'（初回は lastSeen=null で必ずこの値）
// 'no_change' !== 'improved' → true → 改善提案が生成される
if (outcome !== 'improved' && historyRow?.id) {
  await gscSuggestionService.generate({...});
}
```

## 変更後の動作

### 初回評価の処理フロー（変更後）

```
1. last_seen_position = NULL を検出 → 初回と判定
2. gsc_article_evaluations のみ更新:
   - last_seen_position = 現在の順位（ベースライン記録）
   - last_evaluated_on = 本日（次回サイクル計算用）
   - current_suggestion_stage は 1 のまま（変更しない）
3. gsc_article_evaluation_history にはレコードを挿入しない
4. 改善提案を生成しない（Claude API 呼び出しなし）
5. 早期リターン
```

### 2回目以降の動作（変更なし）

```
1. last_seen_position に前回の順位あり
2. judgeOutcome(lastSeen, currentPos) → 'improved' / 'no_change' / 'worse'
3. ステージ進展（改善時リセット、それ以外は +1）
4. 履歴レコード挿入
5. outcome !== 'improved' の場合のみ改善提案生成
```

## 初回評価の判定条件

```typescript
const isBaseline = lastSeen === null;
// = evaluation.last_seen_position が NULL
```

`last_seen_position` は `processEvaluation()` 内でのみ更新され、初回評価完了後に値がセットされる。2回目以降は必ず数値が入っているため、この条件で初回を正確に判定できる。

## 変更対象ファイル

| ファイル | 変更内容 |
| --- | --- |
| `src/server/services/gscEvaluationService.ts` | `processEvaluation()` に初回ベースラインの早期リターンを追加（約15行） |

### 変更不要なファイル

| ファイル | 理由 |
| --- | --- |
| `src/server/services/gscSuggestionService.ts` | 初回時に呼ばれなくなるだけ。変更不要 |
| `src/server/actions/gscNotification.actions.ts` | 初回の履歴レコードが作られないため通知クエリの変更不要 |
| `app/gsc-dashboard/components/EvaluationHistoryTab.tsx` | 同上 |
| `src/types/gsc.ts` | 新しい outcome 型の追加不要 |
| DBマイグレーション | スキーマ変更なし |

## 既存データへの影響

- 既に初回評価で生成された改善提案は、そのまま残る（遡及的な削除は行わない）
- 必要に応じて手動クリーンアップ可能:
  ```sql
  -- 初回評価で生成された不要な履歴レコードの特定
  SELECT * FROM gsc_article_evaluation_history
  WHERE previous_position IS NULL AND outcome = 'no_change';
  ```

## 工数見積もり

**Small**（1ファイル、約15行の追加）

| 作業 | 見積もり |
| --- | --- |
| 実装 | 15分 |
| lint・型チェック | 5分 |
| 手動検証 | 30分 |
| **合計** | **約50分** |

## 検証方法

1. `npm run lint` でエラーがないことを確認
2. 新規記事をGSC評価に登録し、手動で初回評価を実行（`POST /api/gsc/evaluate` with `force: true`）
   - `gsc_article_evaluations.last_seen_position` が更新されること
   - `gsc_article_evaluations.last_evaluated_on` が更新されること
   - `gsc_article_evaluations.current_suggestion_stage` が `1` のままであること
   - `gsc_article_evaluation_history` に新規レコードが追加され**ない**こと
   - Claude API が呼ばれ**ない**こと（コンソールログで確認）
3. 2回目の評価を実行（再度 `force: true`）
   - 通常通り `judgeOutcome` が呼ばれ、履歴・改善提案が生成されること
4. 通知表示の確認
   - 初回評価後に未読通知が表示されないこと
