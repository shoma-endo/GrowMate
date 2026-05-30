# ふるまい保証と検証

リファクタリングで機能を壊さないための分析・検証・記録の手順。

## Step A: 現在のふるまいを理解する

リファクタ前に現在の挙動を完全に把握する:

```markdown
## Behavior Analysis

### Inputs
- [入力パラメータの一覧]
- [型と制約]

### Outputs
- [戻り値]
- [副作用]

### Invariants
- [常に真でなければならない条件]
- [エッジケース]

### Dependencies
- [外部依存]
- [状態依存]
```

## Step B: リファクタ後に検証する

```bash
# 1. テスト実行
npm test -- --coverage

# 2. 型チェック
npx tsc --noEmit

# 3. Lint チェック
npm run lint

# 4. 以前のふるまいと比較（スナップショットテスト）
npm test -- --updateSnapshot
```

> GrowMate ではテスト基盤が限定的なため、最低限 `npm run lint` / `npm run build` を通し、`quality-gate`（`self-review.md`）の 2 パスセルフレビューを併用する。

## Step C: 変更を記録する

```markdown
## Refactoring Summary

### Changes Made
1. [変更1]: [理由]
2. [変更2]: [理由]

### Behavior Preserved
- [x] 同じ入力 → 同じ出力
- [x] 同じ副作用
- [x] 同じエラーハンドリング

### Risks & Follow-ups
- [潜在的なリスク]
- [フォローアップタスク]

### Test Status
- [ ] Unit tests: passing
- [ ] Integration tests: passing
- [ ] E2E tests: passing
```

## トラブルシューティング

### リファクタ後にテストが失敗する
**原因**: ふるまいが変わった
**対処**: 変更を巻き戻して切り分け、1つずつ再適用する

### まだコードが複雑
**原因**: 1つの関数に複数の責務が混在
**対処**: 責務境界を明確にして小さな単位へ抽出する

### パフォーマンスが劣化した
**原因**: 非効率な抽象化を導入した
**対処**: プロファイルしてホットパスを最適化する

## 参考

- [Refactoring (Martin Fowler)](https://refactoring.com/)
- [Clean Code (Robert C. Martin)](https://www.oreilly.com/library/view/clean-code-a/9780136083238/)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
