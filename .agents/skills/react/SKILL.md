---
name: react
description: React 19 + React Compiler の実装規約（Context / use() / Suspense / 最適化）と React Doctor による診断。React コンポーネント実装、Context、useMemo/useCallback 禁止、React 19 パターン、React Doctor 診断・品質改善のときに使う。
---

# React 技術規約

React 19 パターンと React Doctor 診断の統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| Context / use() / Compiler / Suspense / 最適化パターン | [`patterns.md`](patterns.md) |
| Async React（transition / action prop / isPending） | [`async-react-patterns.md`](async-react-patterns.md) |
| React Doctor 診断（スコア・Issues 確認） | [`doctor.md`](doctor.md) |

## 関連スキル

- 実装ポリシー: `implementation-guidelines`
- React Doctor から PR: TAKT `.takt/workflows/react-doctor-to-pr.yaml`
