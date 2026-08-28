# Gherkin受け入れ条件

```gherkin
Feature: {機能名}

Rule: {業務ルール。不要なら省略}

Scenario: {振る舞い}
  Given {前提}
  When {操作}
  Then {期待結果}
```

## 決定事項との対応
- {Gherkinのシナリオ} ← {Grill Meで確定した決定事項}

## 未確定事項
- {Gherkin化の過程で新たに判明した、答えが必要な事項。`01-grill.md` の CON-xxx / OPEN-xxx をここへ移し替えない}

## 判定
`追加確認が必要` または `Gherkin化が完了`
