import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart2, CheckCircle2, Lock, Zap } from 'lucide-react';
import { InstagramGlyph } from '@/components/InstagramGlyph';

export const metadata: Metadata = {
  title: 'GrowMate - 作った記事を、問い合わせに変える集客 AI',
  description:
    'ハウスクリーニング・不用品回収・解体・買取など、暮らしの困りごとを解決する事業者のための集客 AI。増えすぎた記事の中から、直すべき記事と問い合わせにつながっている記事を見つけて、次の一手を提案します。',
};

const SUPPORT_EMAIL = 'support@dreamplanner.co.jp';

const PAIN_POINTS = [
  '地域別のページや料金相場の記事は、AI で何十本、何百本と作れるようになった。',
  'でも、どの記事が読まれていて、どれが問い合わせにつながっているかは、誰も見ていない。',
  '小さな会社のホームページの「お知らせ」は、ほとんど見られない。だから Instagram で発信しているけれど、今度はブログが止まる。',
  '検索順位は見ている。でも、順位が上がっても電話は鳴らない。',
] as const;

const STEPS = [
  '利用を申し込みます。',
  'Google・WordPress・Instagram と連携します。',
  'GrowMate が記事を評価し、直すところを提案します。',
  '提案に沿って記事を直し、新しく書きます。',
] as const;

const TARGET_USERS = [
  'ハウスクリーニング、不用品回収、解体、買取など、地域で暮らしの困りごとを解決している事業者の方。',
  'AI で記事は作っているが、その後の手入れができていない方。',
  'Instagram とブログを両方やっているが、どちらも中途半端になっている方。',
] as const;

const FAQS = [
  {
    question: 'ChatGPT や Claude で十分では？',
    answer:
      '記事を書くことはできます。ただ、書いた記事がどれだけ問い合わせを生んでいるかを毎日見て、直す順番を決めるのは別の仕事です。GrowMate はその仕事を受け持ちます。',
  },
  {
    question: '専門知識は要りますか？',
    answer: '不要です。',
  },
] as const;

function HomeSectionHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="text-center mb-16">
      <h2 className="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
      {description && <p className="text-gray-600 max-w-2xl mx-auto">{description}</p>}
    </div>
  );
}

function HomeCard({ children }: { children: ReactNode }) {
  return (
    <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-lg shadow-gray-100/50 hover:shadow-xl transition-shadow">
      {children}
    </div>
  );
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-gray-700">
      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function NoteText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500 mt-4">{children}</p>;
}

function ApplyButton() {
  return (
    <Button
      size="lg"
      asChild
      className="h-14 px-8 text-lg bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-200"
    >
      <Link href="/login">
        利用を申し込む <ArrowRight className="ml-2 w-5 h-5" />
      </Link>
    </Button>
  );
}

function SupportContactCard({ borderColorClass }: { borderColorClass: string }) {
  return (
    <div className={`p-8 bg-white rounded-2xl shadow-md border ${borderColorClass}`}>
      <h3 className="text-xl font-semibold text-gray-900 mb-3">サポート窓口</h3>
      <p className="text-gray-600 text-sm leading-relaxed">
        連携解除・データ削除・審査用アクセス情報は、以下までご連絡ください。
      </p>
      <ul className="mt-4 text-sm text-gray-700 space-y-2">
        <li>株式会社ドリームプランナー</li>
        <li>〒716-1551 岡山県加賀郡吉備中央町北702</li>
        <li>電話: 090-9922-6467</li>
        <li>メール: {SUPPORT_EMAIL}</li>
      </ul>
      <p className="text-xs text-gray-500 mt-4">受付時間: 平日 10:00-17:00（祝日除く）</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <header className="border-b sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">G</span>
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-900">GrowMate</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="#features"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              機能
            </Link>
            <Link
              href="#pricing"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              料金
            </Link>
            <Link
              href="#compliance"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Google連携
            </Link>
            <Link
              href="#instagram-compliance"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Instagram連携
            </Link>
            <Link
              href="/privacy"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              プライバシーポリシー
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <Button
              asChild
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200"
            >
              <Link href="/login">利用を申し込む</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white -z-10" />
          <div className="mx-auto w-full max-w-7xl px-4 text-center">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100 text-blue-800 text-sm font-medium mb-8 animate-fade-in-up">
              <span className="w-2 h-2 rounded-full bg-blue-600 mr-2" />
              暮らしの困りごとを解決する事業者のための集客 AI
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6 leading-tight max-w-4xl mx-auto">
              AI で記事は作れる。
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                でも、その後の管理は誰が？
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              GrowMate
              は、増えすぎた記事の中から「直すべき記事」と「問い合わせにつながっている記事」を見つけて、次の一手を提案します。
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <ApplyButton />
              <Button
                size="lg"
                variant="outline"
                asChild
                className="h-14 px-8 text-lg border-gray-300 hover:bg-gray-50"
              >
                <Link href="#features">詳細を見る</Link>
              </Button>
            </div>
            <NoteText>ご登録から72時間以内に承認します。</NoteText>
          </div>
        </section>

        <section className="py-24 bg-gray-50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading title="記事は増えたのに、問い合わせが増えない理由" />
            <div className="grid md:grid-cols-2 gap-8">
              {PAIN_POINTS.map(point => (
                <HomeCard key={point}>
                  <p className="text-gray-600 leading-relaxed">{point}</p>
                </HomeCard>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading
              title="GrowMate は「作るAI」ではなく「育てるAI」です"
              description="記事を作った後の評価、改善、次の企画までを引き受けます。"
            />

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {/* Feature 1: GSC / GA4 Integration (Critical for OAuth) */}
              <div className="p-8 rounded-2xl border border-blue-100 bg-blue-50/50 shadow-lg shadow-blue-100/50">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
                  <BarChart2 className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  順位ではなく、問い合わせにつながるかで記事を評価
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Google Search Console や Google Analytics
                  4（読み取り専用）と連携し、検索とアクセスのデータから記事を点数にします。読者がどこで離れているかを診断し、直すべき記事から順に確認できます。
                </p>
              </div>

              {/* Feature 2 */}
              <HomeCard>
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">今ある記事も、まとめて評価</h3>
                <p className="text-gray-600 leading-relaxed">
                  WordPress
                  の記事を取り込んで、まとめて評価を始められます。自分で書いた記事も外注した記事も、同じ基準で比べられます。
                </p>
              </HomeCard>

              {/* Feature 3: Instagram Integration */}
              <div className="p-8 rounded-2xl border border-pink-100 bg-pink-50/50 shadow-lg shadow-pink-100/50 hover:shadow-xl transition-shadow">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-500 rounded-xl flex items-center justify-center mb-6">
                  <InstagramGlyph className="size-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">
                  Instagram で反応が良かった話題を、ブログに
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  お客様の Instagram
                  ビジネスアカウントと連携し、リーチ・いいね・保存などの実績から反応が良かった投稿を見つけて、ブログの企画に活かせます。
                </p>
              </div>

              {/* Feature 4 */}
              <HomeCard>
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-6">
                  <Lock className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">セキュアなデータ管理</h3>
                <p className="text-gray-600 leading-relaxed">
                  お客様のデータは厳重に管理され、許可された範囲内でのみAIの学習や分析に使用されます。プライバシー保護を最優先しています。
                </p>
              </HomeCard>
            </div>
          </div>
        </section>

        <section className="py-24 bg-gray-50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading title="使い方の流れ" />
            <ol role="list" className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {STEPS.map((step, index) => (
                <li key={step}>
                  <HomeCard>
                    <p aria-hidden="true" className="text-3xl font-bold text-blue-600 mb-3">
                      {index + 1}
                    </p>
                    <p className="text-gray-600 leading-relaxed">{step}</p>
                  </HomeCard>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-24 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading title="こんな方に" />
            <ul className="max-w-3xl mx-auto space-y-4">
              {TARGET_USERS.map(user => (
                <CheckItem key={user}>{user}</CheckItem>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-24 bg-gray-50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading title="料金" />

            <div className="max-w-lg mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
              <div className="p-8 text-center">
                <p className="text-gray-600 leading-relaxed mb-8">
                  料金は、事業の規模とご利用内容をうかがってからご案内します。お気軽にお問い合わせください。
                </p>
                <Button
                  size="lg"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  asChild
                >
                  <a href={`mailto:${SUPPORT_EMAIL}`}>メールで問い合わせる</a>
                </Button>
                <NoteText>宛先: {SUPPORT_EMAIL}</NoteText>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4">
            <HomeSectionHeading title="よくある質問" />
            <dl className="max-w-3xl mx-auto space-y-6">
              {FAQS.map(faq => (
                <HomeCard key={faq.question}>
                  <dt className="text-xl font-bold text-gray-900 mb-3">Q. {faq.question}</dt>
                  <dd className="text-gray-600 leading-relaxed">{faq.answer}</dd>
                </HomeCard>
              ))}
            </dl>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-blue-50 to-white">
          <div className="mx-auto w-full max-w-7xl px-4 text-center">
            <HomeSectionHeading title="作った記事を、問い合わせに変えていきましょう" />
            <ApplyButton />
          </div>
        </section>

        {/* Compliance Section */}
        <section id="compliance" className="py-24 bg-blue-50/50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="text-center mb-16">
              <p className="text-sm uppercase tracking-wider text-blue-500 font-semibold mb-2">
                Google OAuth Verification
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Google サービス（GSC / GA4 / Google Ads）連携とデータ取り扱い
              </h2>
              <p className="text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Google Search Console / Google Analytics 4 の読み取り専用スコープ
                <code className="mx-2 bg-white/80 px-2 py-1 rounded text-sm">
                  .../auth/webmasters.readonly, .../auth/analytics.readonly
                </code>
                および Google Ads API スコープ
                <code className="mx-2 bg-white/80 px-2 py-1 rounded text-sm">.../auth/adwords</code>
                を使用し、ユーザーが許可したデータのみを分析します。取得データは
                Supabase（ap-northeast-1）で暗号化保管し、Vercel
                東京リージョンから安全に配信されます。
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mb-12">
              <div className="p-8 bg-white rounded-2xl shadow-md border border-blue-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">OAuth フロー概要</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>1. メール認証で本人確認後、Google に遷移</li>
                  <li>2. 要求されたスコープの許諾内容を確認</li>
                  <li>3. 許可後、ダッシュボードでデータを参照</li>
                  <li>4. データをもとに AI が改善案を提示</li>
                </ul>
              </div>
              <div className="p-8 bg-white rounded-2xl shadow-md border border-blue-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">データ使用と保護</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>各プラットフォームのデータは分析のみに使用します。</li>
                  <li>Vercel 東京リージョン + Cloudflare で TLS 経由の通信を強制。</li>
                  <li>
                    LLM への入力はユーザーが明示的に送信した文章のみ。学習データへ自動転用しません。
                  </li>
                </ul>
              </div>
              <SupportContactCard borderColorClass="border-blue-100" />
            </div>
          </div>
        </section>

        {/* Instagram Compliance Section */}
        <section id="instagram-compliance" className="py-24 bg-pink-50/50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="text-center mb-16">
              <p className="text-sm uppercase tracking-wider text-pink-500 font-semibold mb-2">
                Instagram Platform Data
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Instagram連携とデータ取り扱い
              </h2>
              <p className="text-gray-600 max-w-3xl mx-auto leading-relaxed">
                GrowMateは、中小事業者向けのマーケティング支援ツールです。お客様がご自身のInstagramビジネス／クリエイターアカウントを連携すると、投稿の実績データ（リーチ数・いいね数・保存数など）を取得し、管理画面にわかりやすく一覧表示します。取得したデータはお客様ご自身の投稿の振り返り・改善に役立てるためにのみ使用し、第三者への提供や広告目的での利用は一切行いません。
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-8 bg-white rounded-2xl shadow-md border border-pink-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">連携フロー概要</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>1. メール認証で本人確認後、Instagram に遷移</li>
                  <li>2. 要求された権限の許諾内容を確認</li>
                  <li>3. 許可後、管理画面で投稿実績を参照</li>
                  <li>4. 実績データをもとに次の投稿づくりに活用</li>
                </ul>
              </div>
              <div className="p-8 bg-white rounded-2xl shadow-md border border-pink-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">データ使用と保護</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>Instagramのデータは投稿実績の表示・分析のみに使用します。</li>
                  <li>Vercel 東京リージョン + Cloudflare で TLS 経由の通信を強制。</li>
                  <li>いつでも管理画面から連携を解除でき、解除時に取得済みデータを削除します。</li>
                </ul>
              </div>
              <SupportContactCard borderColorClass="border-pink-100" />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="mx-auto w-full max-w-7xl px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2">
              <h4 className="text-white font-bold text-lg mb-4">GrowMate</h4>
              <p className="text-sm text-gray-400 max-w-sm">
                株式会社ドリームプランナーが提供する業界特化型マーケティングオートメーション。
                Google Search Console / Analytics 4 / Google Ads データと AI
                を組み合わせ、マーケティング施策の意思決定を支援します。
              </p>
              <div className="mt-4 text-xs text-gray-500 space-y-1">
                <p>〒716-1551 岡山県加賀郡吉備中央町北702</p>
                <p>電話: 090-9922-6467 / {SUPPORT_EMAIL}</p>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">リンク</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#features" className="hover:text-white transition-colors">
                    機能一覧
                  </Link>
                </li>
                <li>
                  <Link href="#pricing" className="hover:text-white transition-colors">
                    料金
                  </Link>
                </li>
                <li>
                  <Link href="#compliance" className="hover:text-white transition-colors">
                    Google連携情報
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">法的情報</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/privacy" className="hover:text-white transition-colors">
                    プライバシーポリシー
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-white transition-colors">
                    利用規約
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Dream Planner Inc. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
