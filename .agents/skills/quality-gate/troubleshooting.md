# 代表的なトラブルシューティング

## 認証セッションエラー

- `authMiddleware` のログを確認し、メールセッションの有効期限・検証ロジックに問題がないか確認する。
- `/login` からログイン後、保護ページ遷移が想定通り動作するかを確認する。

## SSE（Server-Sent Events）が途切れる場合

- ping 間隔（例: 20 秒）と idle timeout（例: 5 分）の設定が、既存実装と整合しているか確認する。
- `sendPing` 実装を見直し、一定間隔でクライアントに ping が送られているか、タイムアウト条件が厳しすぎないかを確認する。

## WordPress 投稿取得に失敗する場合

- `WordPressService` の `getRestRequestConfig` 実装を確認し、候補となる REST API URL のリストと認証ヘッダの設定を見直す。
- 実際にどの URL にリクエストを投げているか、レスポンスステータスやエラーメッセージをログで確認する。

## Supabase の RLS が原因で操作できない場合

- 対象テーブルの RLS ポリシーを、対応するマイグレーションファイル（`supabase/migrations/`）で確認する。
- 必要に応じて Service Role での実行に切り替えるか、RLS ポリシーを修正する（`supabase` スキル `rls.md` の指針に従う）。

## 手動検証の観点

画面・機能ごとの確認観点は [`manual-testing.md`](manual-testing.md) を参照。
