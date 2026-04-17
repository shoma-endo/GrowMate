# Google Ads API 接続手順

## 概要

本プロジェクトで Google Ads API を利用するための設定手順を説明します。

## 前提条件

- Google Cloud Console へのアクセス権限
- Google Ads アカウント（MCC または標準アカウント）
- 本番環境で実データを扱う場合は Developer Token の審査承認が必要

## 1. Google Cloud Console での設定

### 1.1 プロジェクトの作成または選択

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを新規作成または既存プロジェクトを選択

### 1.2 Google Ads API の有効化

1. 「APIとサービス」→「ライブラリ」を開く
2. 「Google Ads API」を検索して有効化

### 1.3 OAuth 同意画面の設定

1. 「APIとサービス」→「OAuth 同意画面」を開く
2. ユーザータイプを選択（外部）
3. 必要な情報を入力:
   - アプリ名
   - ユーザーサポートメール
   - デベロッパーの連絡先
4. スコープを追加:
   - `https://www.googleapis.com/auth/adwords`

### 1.4 OAuth クライアント ID 作成

1. 「APIとサービス」→「認証情報」を開く
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリの種類: 「ウェブ アプリケーション」
4. 承認済みのリダイレクト URI を設定
5. クライアント ID とシークレットをメモ

> **注意**: テストユーザーに登録されていないアカウントで認可しようとすると、「アクセスがブロックされました」エラーが発生します。開発チームメンバーや検証に使用するアカウントは必ず登録してください。

## 2. 参考リンク

- [Google Ads API ドキュメント](https://developers.google.com/google-ads/api/docs/start)
- [keyword_view フィールドリファレンス](https://developers.google.com/google-ads/api/fields/v22/keyword_view)
- [GAQL クエリビルダー](https://developers.google.com/google-ads/api/fields/v22/query_builder)
- [エラーコード一覧](https://developers.google.com/google-ads/api/docs/common-errors)
