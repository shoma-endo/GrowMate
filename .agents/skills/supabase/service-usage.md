# Supabase サービス利用規約

プロジェクトにおける Supabase 操作の「唯一の正解 (SSoT)」を定義します。

## 1. サービス層の統一 (Unification)

- **原則**: すべての Supabase 操作は、基底クラス `SupabaseService` (実ファイル: `src/server/services/supabaseService.ts`) またはそのドメイン別サブクラス（例: `userService.ts`, `chatService.ts`）を介して実行してください。
- **禁止事項**: 業務ロジック内で `@supabase/supabase-js` を直接インポートして `createClient` を呼び出し、アドホックなクエリを記述することは厳禁です。

## 2. クライアント管理 (Client Management)

- **管理層**: クライアントの生成・管理は `src/lib/client-manager.ts` (`SupabaseClientManager`) が一括して担います。
- **インスタンス取得**:
  - `SupabaseService` 内では `SupabaseClientManager.getInstance().getServiceRoleClient()` を使用して特権操作を行います。
  - 特殊なケースを除き、直接 `manager` を叩くのではなく `SupabaseService` を継承・利用してください。

## 3. Service Role 利用の安全基準

- [IMPORTANT] `Service Role` は RLS を完全にバイパスするため、利用は以下の用途に限定してください。
  - **管理処理 (Admin)**: ユーザーロールの変更、全ユーザー一覧の取得など。
  - **バックグラウンド処理 (Batch/Cron)**: GSC データインポート、定期的なデータ評価など。
  - **特権が必要な内部 API**: 認証ユーザーの紐付け更新、システム整合性チェックなど。
- [WARNING] RLS が効かないため、**アプリケーション層での明示的な ID チェックを省略してはなりません**。
  - クエリに `.eq('user_id', userId)` 等を含め、操作対象がそのユーザーの所有物であることを必ず保証してください。
- **推奨パターン**: 静的な特権操作が必要な場合は、`SupabaseService` を継承し、実在する `protected static withServiceRoleClient()` ユーティリティを活用してください（自動的に詳細なログが付与されます）。

## 4. エラーハンドリングとログ (Error Handling)

- **統一フォーマット**: `SupabaseService` の `protected failure()` メソッド（インスタンスメソッド、`supabaseService.ts` 参照）を必ず使用し、ユーザー向けメッセージとエンジニア向け詳細ログ（`PostgrestError`, `context`）を適切に分離・記録してください。

## 5. 実装パターン (Recommended Pattern)

- Server Actions / Route Handlers 等からは、ドメイン固有のサービスを通じて `SupabaseService` の機能を呼び出します。

```typescript
export class AnalyticsContentService extends SupabaseService {
  static async getSomething(userId: string) {
    return this.withServiceRoleClient(
      async client => {
        const { data, error } = await client
          .from('content_annotations')
          .select('*')
          .eq('user_id', userId);
        if (error) throw error;
        return data;
      },
      { logMessage: 'データ取得エラー:' }
    );
  }
}
```

## 運用ルール

1. 新規テーブル追加時は、`supabaseService.ts` またはそのサブクラスに CRUD メソッドを追加することを基本としてください。
2. 複雑な結合クエリやパフォーマンスが重要な操作は、可能な限り Supabase RPC (関数) として実装し、サービス層から呼び出してください。
   - 目安: 3 テーブル以上の結合、サブクエリ/CTE/ウィンドウ関数を含む集計、条件分岐が 3 つ以上のビジネスロジック、クライアント側での後処理が重いケース、レイテンシに敏感なバッチ処理。
3. **取得上限とデータ打ち切りに注意**: PostgREST には `db-max-rows = 1000` のグローバル上限があり、`.limit(5000)` と書いても 1000 で切られます。大量行の取得、コード内での突合・集計、LLM プロンプト用データの用意を行う場合は、必ず `docs/context/db-row-limits-and-data-truncation.md`（2026-06 の実障害由来の知見）を先に読んでください。突合用とプロンプト用の取得は分離し、打ち切りが起きる場合は検知できる状態（ログ/フラグ）にします。

## 関連

- RLS / マイグレーション: [`rls.md`](rls.md)
- 取得上限・データ打ち切りの指針: `docs/context/db-row-limits-and-data-truncation.md`
