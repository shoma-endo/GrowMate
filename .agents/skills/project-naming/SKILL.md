---
name: project-naming
description: GrowMate全域の命名規則を確認する唯一の正本（SSoT）。ディレクトリ、ファイル、パス、変数、関数、型、定数、DB項目、API項目の名前を新規作成・変更・リネームするとき、または命名に迷ったときに必ず使う。実装内容だけを変更し命名判断が不要な作業では使わない。
---

# プロジェクト命名規則

このスキルは、プロジェクトにおけるすべての命名の「唯一の正解 (Single Source of Truth)」を定義します。常にこの規約を守ってください。

## 命名規則ガイドライン

### 1. ディレクトリ命名

- **原則**: すべて `kebab-case` (例: `business-info/`, `api/google-oauth/`, `src/server/actions/`)

### 2. ファイル命名 (接尾辞・ケースの徹底)

- **Next.js 固定名**: `page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`, `not-found.tsx`, `template.tsx`
- **コンポーネント**:
  - **shadcn/ui**: `kebab-case.tsx` (例: `button.tsx`, `avatar.tsx`)
  - **カスタム**: `PascalCase.tsx` (例: `ChatClient.tsx`, `CanvasPanel.tsx`)
- **実装ファイル (論理命名/ドメイン系)**:
  - **Hooks**: `camelCase.ts` (例: `useChatSession.ts`)
  - **Services**: `...Service.ts` (例: `chatService.ts`, `supabaseService.ts`)
  - **Actions**: `...actions.ts` (例: `user.actions.ts`)
  - **Middleware**: `...middleware.ts` (例: `auth.middleware.ts`)
  - **Schemas**: `...schema.ts` (例: `brief.schema.ts`)
  - **Models**: `...Models.ts` (例: `chatModels.ts`)
- **その他 (物理命名/モジュール系)**:
  - **Types**: `kebab-case.ts` (例: `chat.ts`, `analytics.ts`)
  - **Lib/Utils**: `kebab-case.ts` (例: `client-manager.ts`, `blog-canvas.ts`)

### 3. コード内命名

- **React コンポーネント / クラス / 型 / インターフェース / Enum**: `PascalCase`
- **関数・メソッド / 変数 / パラメータ**: `camelCase`
- **定数 (グローバル・設定)**: `UPPER_SNAKE_CASE` (例: `MODEL_CONFIGS`, `ERROR_MESSAGES`)

## 運用ルール

1. このファイルを絶対的な基準とし、Skill 正本は `.agents/skills/` に置く（Codex / Cursor はここを直接走査。Claude Code 用に `.claude/skills` のみ symlink）。
2. 命名に迷った場合、ドキュメントではなくこのスキルの定義を優先してください。
