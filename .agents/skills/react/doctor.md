# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

```bash
npx -y react-doctor@latest . --verbose --diff
```

## Workflow

React 変更後に実行し、問題を早期検出する。エラーを先に修正し、再実行してスコア改善を確認する。

## 一気通貫 PR 作成

診断から PR まで自動化する場合は `react-doctor-to-pr` スキルを使う。
