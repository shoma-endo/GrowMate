# GrowMate - AIマーケティング支援プラットフォーム

LINE LIFF またはメール OTP を入り口に、業界特化のマーケティングコンテンツを一括生成・管理する SaaS アプリケーションです。Next.js（App Router）を基盤に、マルチベンダー AI、WordPress 連携、Supabase による堅牢なデータ管理を統合しています。フレームワークのバージョンは [`package.json`](package.json) を参照してください。

## 🧭 プロダクト概要

- LIFF でログインしたユーザー向けに、広告／LP／ブログ制作を支援する AI ワークスペースを提供
- Anthropic Claude と OpenAI のモデル（Fine-tuned 含む）を [`src/lib/constants.ts`](src/lib/constants.ts) の `MODEL_CONFIGS` で用途に応じて切り替え
- WordPress.com / 自社ホスティングを問わない投稿取得と、Supabase へのコンテンツ注釈保存
- 管理者向けのプロンプトテンプレート編集・ユーザー権限管理 UI を内蔵

test