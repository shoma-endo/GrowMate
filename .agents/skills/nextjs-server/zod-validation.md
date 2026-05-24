# Zod バリデーション技術規約

Zod 4 を使用したバリデーションにおいて、一貫性・型安全性・保守性を担保するためのルールです。

## 1. スキーマ配置規約

| カテゴリ           | 配置パス                                    | 例                                  |
| ------------------ | ------------------------------------------- | ----------------------------------- |
| サーバー用スキーマ | `src/server/schemas/[feature].schema.ts`    | `chat.schema.ts`, `brief.schema.ts` |
| 環境変数スキーマ   | `src/env.ts`                                | 一元管理                            |
| インラインスキーマ | Server Actions 内で定義（小規模な場合のみ） | `updateChatSessionTitleSchema`      |

## 2. スキーマ定義ルール

### 2.1 基本パターン

```ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  email: z.email(), // Zod 4: トップレベル関数を使用
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'paid', 'trial', 'unavailable']),
  createdAt: z.iso.datetime().optional(),
});

export type User = z.infer<typeof userSchema>;
```

### 2.2 Zod 4 推奨パターン

#### トップレベル文字列フォーマット（必須）

```ts
// ✅ 推奨: Zod 4 のトップレベル関数
z.email();
z.url();
z.uuidv4();
z.iso.datetime();

// ❌ 非推奨: メソッドチェーン（将来削除予定）
z.string().email();
z.string().url();
z.string().uuid();
```

#### `.meta()` によるメタデータ付与

```ts
const emailSchema = z.email().meta({
  description: 'ユーザーのメールアドレス',
  examples: ['user@example.com'],
});
```

#### `.overwrite()` による型保持変換

```ts
z.string().overwrite(val => val.trim());
z.string().trim();
z.string().toLowerCase();
```

#### 統一された `error` パラメータ

```ts
z.string().min(5, { error: '5文字以上で入力してください' });

z.string({
  error: issue => (issue.input === undefined ? 'この項目は必須です' : '文字列で入力してください'),
});
```

### 2.3 オプショナルフィールドのバリデーション

```ts
const createOptionalUrlValidator = () =>
  z
    .string()
    .optional()
    .refine(
      val => {
        if (!val || val === '') return true;
        return z.url().safeParse(val).success;
      },
      {
        error: '有効なURLを入力してください',
      }
    )
    .transform(val => {
      if (val === '') return undefined;
      return val;
    });
```

## 3. バリデーション実行規約

### 3.1 Server Actions でのバリデーション

```ts
'use server';

import { z } from 'zod';
import { mySchema } from '@/server/schemas/my.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export async function myAction(data: z.infer<typeof mySchema>) {
  try {
    const validated = mySchema.parse(data);
    // ... 処理
    return { success: true, data: result };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const formatted = z.prettifyError(e);
      console.error('Validation failed:', formatted);
      return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
    }
    throw e;
  }
}
```

### 3.2 safeParse を使用したパターン

```ts
const result = mySchema.safeParse(data);

if (!result.success) {
  console.error('Validation errors:', z.prettifyError(result.error));
  return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
}

const validated = result.data;
```

## 4. エラーハンドリング連携

→ バリデーションエラーのユーザー向けメッセージ・`ERROR_MESSAGES` 連携は [`error-handling.md`](error-handling.md) §2.5 を参照。

## 5. 高度なパターン

### 5.1 再帰的オブジェクト（Zod 4）

```ts
const Category = z.object({
  name: z.string(),
  get subcategories() {
    return z.array(Category);
  },
});

type Category = z.infer<typeof Category>;
```

### 5.2 Discriminated Union

```ts
const Result = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), data: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
```

### 5.3 数値フォーマット（Zod 4）

```ts
z.int();
z.int32();
z.uint32();
z.float32();
```

## 6. アンチパターン

- [ ] クライアントコンポーネント内でスキーマを定義する
- [ ] `z.string().email()` など非推奨のメソッドチェーンを使用する
- [ ] エラーメッセージをスキーマ内にハードコードする（`ERROR_MESSAGES` を使用すべき）
- [ ] `parse()` の例外を適切にハンドリングせずに上位に伝播させる
- [ ] 型導出なしでスキーマを使用する（`z.infer<typeof schema>` を必ず定義）

## 7. セルフレビュー項目

- [ ] スキーマは適切なパス（`src/server/schemas/*.schema.ts`）に配置されているか
- [ ] `z.infer` で型を導出しているか
- [ ] トップレベル文字列フォーマット（`z.email()` 等）を使用しているか
- [ ] バリデーションエラーを `ERROR_MESSAGES` 経由で返却しているか
- [ ] 例外処理が適切に実装されているか
