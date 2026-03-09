---
name: update-docs
description: This skill should be used when the user asks to update or review documentation, or when code changes need to be synced with docs. Provides a guided workflow for updating documentation based on code changes.
---

# Documentation Update Workflow

Use this skill when:

- ユーザーが「ドキュメントを更新して」「この PR に合わせて docs を直して」と依頼したとき
- コード変更が docs に影響しそうだが、どこをどう直すべきか整理したいとき

## Quick Start

1. **変更範囲の把握**: `git diff` などで変更ファイルを洗い出す。
2. **ドキュメントへの影響範囲を特定**: どの docs（.md/.mdx）が影響を受けるかをマッピングする。
3. **各 doc の内容を読んでから更新方針を決める**。
4. **ユーザーと確認しながら編集する**。
5. **lint / preview で確認してからコミットする**。

## Step 1: 変更コードの把握

- ブランチ上の差分を確認する:

```bash
git diff --stat
```

- 特定ディレクトリだけ見たい場合はパスを絞る:

```bash
git diff --stat -- src/ app/ docs/
```

## Step 2: docs への影響を判断する

コード変更から、どの種類の docs が影響するかを考える:

- コンポーネント API の変更 → コンポーネントのリファレンス / 使用例
- サーバー関数や設定の変更 → API リファレンス / 設定リファレンス
- フローや UX の変更 → ガイド / チュートリアル系

影響がありそうな docs がわからない場合は、以下のように考える:

- 「この変更でユーザーが迷うポイントは何か？」
- 「どの画面・エンドポイント・コンポーネントの使い方が変わったか？」

## Step 3: 既存 docs を読む

変更前の docs を読み、次を把握する:

- どの前提・制約・ユースケースが書かれているか
- セクション構成と Frontmatter（`title`, `description` など）
- サンプルコードがどのパターンをカバーしているか

いきなり書き換えず、「何が古くなるのか／不足しているのか」を明確にする。

## Step 4: 具体的な更新内容を決める

よくある更新パターン:

- **新しい props / options**:
  - Props テーブルに追加し、詳細セクションを作る。
  - サンプルコードに新オプションを含める。

- **挙動の変更**:
  - 旧挙動の説明を削除または修正する。
  - 必要なら「旧バージョンとの違い」を 1 セクション設ける。

- **非推奨になった機能**:
  - 明示的に「非推奨」と書き、代替手段と移行手順を説明する。

- **新機能の追加**:
  - ガイドやチュートリアルが必要かどうかを検討。
  - 既存セクションに追記で足りるか、別ページにすべきかを判断。

## Step 5: ユーザーと対話しながら編集する

ドキュメント更新の際は、以下のプロセスを踏む:

1. どのファイルをどう直すかを箇条書きで提案する。
2. ユーザーの確認をとってから実際の編集に入る。
3. 大きな書き換えの場合は、セクション単位で確認を挟む。

## Step 6: フォーマットと整合性をチェック

- Frontmatter:

```yaml
---
title: Page Title (2-3 words)
description: 1〜2文でページの内容を説明する。
---
```

- コードブロック:

```mdx
```tsx filename="app/example.tsx" switcher
// TypeScript example
```

```jsx filename="app/example.js" switcher
// JavaScript example
```
```

- テーブルや見出しがプロジェクト内の他 docs とスタイル的に揃っているかを確認する。

## Step 7: 自動チェックとプレビュー

- docs 専用の lint / prettier があれば実行する。
- プロジェクトのルールに従って、`npm run lint` やビルドを実行する。
- プレビューできる場合は、該当ページをブラウザで確認し、レイアウト崩れやリンク切れがないかを見る。

## 最後のチェックリスト

- [ ] 変更したコードに対応する docs がすべて更新されている。
- [ ] 古い情報や誤解を招く記述が残っていない。
- [ ] 新しい挙動・オプション・制約が明確に説明されている。
- [ ] サンプルコードが実際の API と一致している。
- [ ] Lint / ビルドが通っている。

