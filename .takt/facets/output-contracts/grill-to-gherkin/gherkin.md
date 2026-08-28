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

## 確認したい質問
- {シナリオを確定できない場合に、標準 Grill Me で確認する質問を列挙する。確定できた場合は「なし」}

## 判定
`追加確認が必要` または `Gherkin化が完了`
