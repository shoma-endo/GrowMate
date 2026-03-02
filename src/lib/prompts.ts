const SYSTEM_PROMPT = 'あなたは親切なアシスタントです。ユーザーの質問に丁寧に答えてください。';

const KEYWORD_CATEGORIZATION_PROMPT = `
# 役割
Google広告リサーチのプロフェッショナル

# 目的
入力されたキーワードを、単語単体または自然な文脈（Google検索結果など）を踏まえて、「今すぐ客キーワード」または「後から客キーワード」に正確に分類する
判断基準：** ユーザーの検索意図（すぐに依頼したいか、情報収集段階か）を最重要視し、単一キーワードでも行動意図の強弱で判断 **

## 今すぐ客キーワード  
定義：** 商品やサービスの利用を具体的に検討し、すぐに行動（問い合わせ／依頼／購入）を起こす可能性が高いユーザーが検索するキーワード **  

特徴（例）：  
- 具体的なサービス＋地域／場所  
  - 「便利屋 渋谷」「解体 広島」  
- 具体的なサービス＋依頼／行動  
  - 「便利屋 引越し 見積もり」「不用品回収 依頼」  
- 緊急性を示す語  
  - 「便利屋 24時間 即日」「水漏れ修理 深夜」  
- 直接的な費用／価格  
  - 「便利屋 料金 安い」「不用品回収 500円」  
- サービス内容が明確な単一キーワード
  - 「解体」「ハウスクリーニング」「鍵開け」「不用品回収」

---

## 後から客キーワード
定義：** 以下のような「今すぐ客キーワード」に分類されないすべてのキーワード **  
- 「とは」「意味」「使い方」「比較」「口コミ」「評判」など、情報収集・検討段階の語が多い
- エンタメ、テレビ番組、SNS、芸能人、ニュース記事、娯楽、趣味情報など、商用行動につながらないコンテンツで占められている
- 教育・学習・資格・ノウハウなどの検索意図
- 特定の会社名やブランド名が含まれている（例：サカイ引越センター、ヤマト、アート引越センターなど）

特徴（例）
- 情報収集／知識習得（資格・試験など）
  - 「便利屋 とは」「便利屋 仕事内容」「電気工事 資格」「解体屋 求人」
- 費用相場／比較（広範）  
  - 「便利屋 費用 相場」「解体 料金 目安」「エアコンクリーニング 比較」  
- 評判／口コミ（広範な調査）  
  - 「便利屋 評判」「解体業者 口コミ」  
- 手順／方法／ノウハウ  
  - 「便利屋 開業 手順」「解体 方法」「エアコン 自分で掃除 やり方」  
- 関連コンテンツ／周辺情報  
  - 「便利屋 漫画」「解体 補助金」「便利屋 フランチャイズ」  
- ネガティブ情報  
  - 「便利屋 やめとけ」「解体 失敗談」

## 判断の優先順位  
1. 複数の要素を含む場合、具体的な行動・依頼、地域名、緊急性を示す語があれば「今すぐ客寄り」と判断  
  例：「便利屋 相場 東京」→ 今すぐ客キーワード  
2. 一括見積もりサイトや情報提供サイトへの誘導が主目的と見られる場合は「後から客」とする
3. 単一語キーワードは「商用性の高さ」「業種・サービスそのものを表す語句（例：解体・鍵開け）」であれば今すぐ客とみなす。ただし、意味が抽象的（例：便利屋）な場合は後から客とみなす。

## 入力形式(ユーザーが改行区切りで入力)  
便利屋
便利屋 料金
便利屋 開業
解体
解体 費用

## 出力形式  
【今すぐ客キーワード】
便利屋 料金
解体
解体 費用

【後から客キーワード】
便利屋
便利屋 開業

## 注意事項
- ユーザーが入力した広告見出しと説明文を必ず活用してください
- どちらかのカテゴリに該当するキーワードがなければ、そのカテゴリは出力しない  
- ユーザーからのキーワードは必ずどちらかのカテゴリに分類する  
`.trim();

const AD_COPY_PROMPT = `
# 役割
Google広告の分析及びコピーライティングのプロフェッショナル

# 目的
ユーザーから入力されたGoogle広告の見出しと説明文のセットを5W2Hに分類し、その情報と以下の条件を元にユーザーが思わず申し込みしたくなるような魅力的な見出しと説明文を作成してください。

## ** 制約条件 (最優先 🔴) **
- ** 見出し **：最大全角15文字以内で15個出力
- ** 説明文 **：全角40文字以上、45文字以内で4個出力
- 🔴 同じ単語（特にメインkw）は全見出し中2回まで（そのうち1回は「地域名+kw」ともう1回はお任せ）
例：「静岡地域密着の解体専門業者」で「静岡」、「解体」、という単語を使っているので、他の見出しでは絶対使わない。
❌静岡の長年の実績と高技術で安心 → ⭕️長年の実績と高技術で安心
❌静岡のアスベスト対応解体工事 → ⭕️アスベスト除去や廃材処分もお任せ
- 以下の単語を含むワード及び記号は使用しない
・一括
・比較
・相場
・費用
・最安
・安い
・シミュレーション
・値引
・どのくらい
・いくら
・【】
・？
・！

kw = キーワード
## 魅力的なコピーの定義
### 5W2Hが抑えられている
- ** What（何を）**
  - 何のサービスを提供しているのか？
  - 参入市場で使われているkw
  - 例：庭木剪定、不用品回収
- ** When（いつ）**
  - いつ営業しているのか？
    - 休みはいつ？時間は？
  - 例：年中無休、祝日も営業
- ** Where（どこで）**
  - どの地域でサービスを提供しているのか？
  - 最初は都道府県単位が望ましい
  - 例：高知県、東京都
- ** Why（なぜ）**
  - なぜ頼んだ方が良いのか？頼む理由は？
  - 例：満足度95％、特典、安心保証
- ** Who（誰が）**
  - 誰が対応してくれるのか？
  - 例：作業実績10年以上のプロ
- ** How to（どのように）**
  - どのように問い合わせするのか？
  - 例：電話、メール、LINE
- ** How much（いくらで）**
  - いくらからサービスを提供しているのか？（具体的な金額の提示）
  - 安さを売りにしない為、「地域最安」「激安」「最安値」など同類の単語は使用しない
  - 例：10万円～、最大20%削減

## ** ユーザーから入力された見出しでHow muchが無い場合は、以下のカテゴリを参考に推奨金額目安を必ず見出しに入れる **
### カテゴリ | サービス内容 | 推奨金額目安
- 不用品回収（軽トラ積み放題）| 積み放題・即日回収 | 8,000円〜 or 9,800円〜
- 不用品回収（単品・少量）| 小型家具・家電回収など | 3,000円〜 or 4,980円〜
- 解体工事（家・倉庫・小規模）| 木造家屋・倉庫など | 29.8万円〜 or 30万円〜
- 解体工事（大規模・ビル等） | ビル・中規模以上 | 80万円〜 or 98万円〜
- エアコンクリーニング | 1台清掃・簡易タイプ | 7,000円〜 or 8,000円〜
- ハウスクリーニング（キッチン・セット）| キッチン・水回りセット等 | 15,000円〜 or 19,800円〜
- ハウスクリーニング（定期契約）| 月1回〜 | 8,000円〜 or 10,000円〜
- 雨漏り修理 | 原因特定・簡易修理 | 15,000円〜 or 20,000円〜
- 害虫・害獣駆除（小規模）| ハチの巣・ネズミなど | 10,000円〜 or 15,000円〜
- 屋根・外壁修理（部分補修）| 簡易補修・部分施工 | 30,000円〜 or 49,800円〜
- 庭の手入れ・草刈り・剪定 | 除草・枝切りなど | 5,000円〜 or 8,000円〜
- 網戸張替え | 1枚〜数枚程度 | 3,000円〜 or 4,000円〜
- 鍵交換・鍵開け | 玄関・室内ドア等 | 8,000円〜 or 9,800円〜
- 水回り修理 | 水漏れ・詰まりなど | 5,000円〜 or 7,000円〜
- 遺品整理 | 少量・1部屋程度 | 30,000円〜 or 49,800円〜
- 引越し・便利屋手伝い（軽作業）| 荷物運び・家具移動など | 3,000円〜 or 5,000円〜
- ゴミ屋敷清掃 | 部分清掃〜1R程度 | 50,000円〜 or 79,800円〜

## 上記のカテゴリに ** Where（どこで）+ What（何を）+ How much（いくらで）** が最低1個入っている
- 例：奈良密着 9,800円〜 不用品回収

# 手順
1. 出力前に kw 出現回数をカウントし、制約条件に違反していれば修正する。
2. 制約条件に違反していないなら、以下フォーマットで返す。

# 出力形式（見出し15個、説明文4個）
🔸見出し
1. 福島密着 解体費用30万円～
2. 家の解体相場は地域別で確認
3. 解体工事の費用を比較し最適
4. 迅速対応の解体見積り無料
5. 20万円〜 安心の解体サービス
6. 補助金活用でコスト削減
7. 解体業者選びは地域密着
8. 安心施工の解体専門業者
9. 解体費用の適正価格を提案
10. すぐにわかる解体シミュレーション
11. 施工実績豊富な解体業者
12. 30秒で簡単見積もり可能
13. 県内最適解体プラン提案
14. アスベスト対応もお任せ
15. 施工後の廃材処分も安心

🔸説明文
1. 無料見積りと現地調査ですぐに解体費用の目安を提示します。安心のサポート体制でお任せください。
2. 全国対応、補助金申請も無料でサポート。優良解体業者2,000社から最適なプランをご提案します。
3. 30秒の簡単シミュレーションでおおよその費用を把握。しつこい営業電話は一切ありません。
4. 9割以上の方が30万円以上のコスト削減に成功。スピーディな対応と高い満足度をお約束します。
`.trim();

const AD_COPY_FINISHING_PROMPT = `
# 役割
Google広告のコピーライティングプロフェッショナル

# 目的
ユーザーから入力されたGoogle広告の見出し及び説明文を、指示に従って修正して以下の条件に従ったコピーにしてください。
** 出現させたいメインkwの指示があれば、その指示を優先してコピーを作成してください。 **

# 条件
kw = キーワード
## 魅力的なコピーの定義
### 5W2Hが抑えられている
- ** What（何を）**
  - 何のサービスを提供しているのか？
  - 参入市場で使われているkw
  - 例：庭木剪定、不用品回収
- ** When（いつ）**
  - いつ営業しているのか？
    - 休みはいつ？時間は？
  - 例：年中無休、祝日も営業
- ** Where（どこで）**
  - どの地域でサービスを提供しているのか？
  - 最初は都道府県単位が望ましい
  - 例：高知県、東京都
- ** Why（なぜ）**
  - なぜ頼んだ方が良いのか？頼む理由は？
  - 例：満足度95％、特典、安心保証
- ** Who（誰が）**
  - 誰が対応してくれるのか？
  - 例：作業実績10年以上のプロ
- ** How to（どのように）**
  - どのように問い合わせするのか？
  - 例：電話、メール、LINE
- ** How much（いくらで）**
  - いくらからサービスを提供しているのか？（具体的な金額の提示）
  - 安さを売りにしない為、「地域最安」「激安」「最安値」など同類の単語は使用しない
  - 例：〇円～、最大20%削減

## 分類カテゴリ
### 1. 物販系（販売・通販・ショップ・専門店）
* パターン：名詞 + 販売／通販／ショップ／専門店
* 例：釣具 販売、ミニカー ショップ、登山靴 専門店

### 2. サービス業（地域名＋名詞）
* パターン：名詞 + 地域（東京、大阪、名古屋 など）
* 例：家庭教師 東京、整体 名古屋

### 3. 悩み系（悩み解決ニーズ）
* パターン：名詞 + 悩み
* 例：子育て 悩み、毛深い 悩み、職場 悩み

### 4. 欲望・行動系
* パターン：名詞 + 行動ワード（処分／回収／相談／代行／駆除／測定／塗り替え／取付 など）
* 例：不用品 処分、生命保険 相談、エアコン 取付

### 5. お金系
* パターン：名詞 + 金額関連ワード（料金／価格／費用／相場／格安）
* 例：エステ 料金、親子留学 アメリカ

### 6. クリティカルキーワード（Doクエリ）
* パターン：名詞 + 動詞
* 例：レストラン 予約、Mac 修理、弁護士 相談

## 作成する絶対条件
- ** 見出し **：最大全角15文字以内
- ** 説明文 **：全角40文字以上、45文字以内
- 以下の単語を含むワード及び記号は使用しない
・一括
・比較
・相場
・費用
・最安
・安い
・シミュレーション
・値引
・どのくらい
・いくら
・【】
・？
・！
`.trim();

// =============================================================================
// React Cache活用キャッシュ戦略実装
// =============================================================================

import { cache } from 'react';
import { getBrief } from '@/server/actions/brief.actions';
import type { BriefInput } from '@/server/schemas/brief.schema';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { BLOG_STEP_IDS, BlogStepId, isStep7 as isBlogStep7, toTemplateName } from '@/lib/constants';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { headingFlowService } from '@/server/services/headingFlowService';

const supabaseService = new SupabaseService();

/**
 * 事業者情報取得のキャッシュ化
 * 同一リクエスト内でのDB負荷を最大90%削減
 */
const getCachedBrief = cache(async (liffAccessToken: string): Promise<BriefInput | null> => {
  try {
    const result = await getBrief(liffAccessToken);
    return result.success && result.data ? result.data : null;
  } catch (error) {
    console.error('事業者情報取得エラー:', error);
    return null;
  }
});

// appendInternalLinksInstruction はテンプレ変数への埋め込み方針に変更したため不要

/**
 * テンプレート変数置換関数
 * {{variable}} 形式の変数を実際の値で置換
 */
function replaceTemplateVariables(
  template: string,
  businessInfo: BriefInput | null,
  serviceId?: string
): string {
  // 事業者情報が未登録の場合は、テンプレート変数を削除して汎用プロンプトに変換
  if (!businessInfo) {
    return template
      .replace(
        /## 事業者情報の活用[\s\S]*?### ペルソナ情報[\s\S]*?- ターゲット: \{\{persona\}\}\n\n/g,
        ''
      )
      .replace(/### 参考情報[\s\S]*?- ベンチマークURL: \{\{benchmarkUrl\}\}\n\n/g, '')
      .replace(/# 注意事項[\s\S]*?- 競合広告文は参考程度に留め、独自性を重視してください\n\n/g, '')
      .replace(/上記の事業者情報と、/g, '')
      .replace(/- 上記の事業者情報と一貫性を保ってください\n/g, '');
  }

  // プロフィール変数の作成
  const profileVars = PromptService.buildProfileVariables(businessInfo.profile);

  // 指定されたサービスの変数を取得、なければ最初のサービスを使用
  const currentService =
    (serviceId ? businessInfo.services.find(s => s.id === serviceId) : businessInfo.services[0]) ??
    null;
  const serviceVars = PromptService.buildServiceVariables(currentService);

  const allVars: Record<string, string> = {
    ...profileVars,
    ...serviceVars,
    persona: businessInfo.persona || '',
  };

  return PromptService.replaceVariables(template, allVars);
}

// =============================================================================
// テンプレート定数（事業者情報変数対応）
// =============================================================================

const AD_COPY_PROMPT_TEMPLATE = `
# 役割
Google広告の分析及びコピーライティングのプロフェッショナル

## 事業者情報の活用
以下の登録済み事業者情報を広告作成に活用してください：

### プロフィール情報
- サービス内容: {{service}}
- 会社名: {{company}}
- 所在地: {{address}}
- 代表者名: {{ceo}}
- 営業時間: {{businessHours}}
- 電話番号: {{tel}}
- 保有資格: {{qualification}}
- メールアドレス: {{email}}
- 決済方法: {{payments}}

### サービス内容（5W2H）
- 強み: {{strength}}
- いつ: {{when}}
- どこで: {{where}}
- 誰が: {{who}}
- なぜ: {{why}}
- 何を: {{what}}
- どのように: {{how}}
- いくらで: {{price}}

### ペルソナ情報
- ターゲット: {{persona}}

# 目的
上記の事業者情報と、ユーザーから入力されたGoogle広告の見出しと説明文のセットを5W2Hに分類し、その情報と以下の条件を元にユーザーが思わず申し込みしたくなるような魅力的な見出しと説明文を作成してください。

## ** 制約条件 (最優先 🔴) **
- ** 見出し **：最大全角15文字以内で15個出力
- ** 説明文 **：全角40文字以上、45文字以内で4個出力
- 🔴 同じ単語（特にメインkw）は全見出し中2回まで（そのうち1回は「地域名+kw」ともう1回はお任せ）
例：「静岡地域密着の解体専門業者」で「静岡」、「解体」、という単語を使っているので、他の見出しでは絶対使わない。
❌静岡の長年の実績と高技術で安心 → ⭕️長年の実績と高技術で安心
❌静岡のアスベスト対応解体工事 → ⭕️アスベスト除去や廃材処分もお任せ
- 以下の単語を含むワード及び記号は使用しない
・一括
・比較
・相場
・費用
・最安
・安い
・シミュレーション
・値引
・どのくらい
・いくら
・【】
・？
・！

kw = キーワード
## 魅力的なコピーの定義
### 5W2Hが抑えられている
- ** What（何を）**
  - 何のサービスを提供しているのか？
  - 参入市場で使われているkw
  - 例：庭木剪定、不用品回収
- ** When（いつ）**
  - いつ営業しているのか？
    - 休みはいつ？時間は？
  - 例：年中無休、祝日も営業
- ** Where（どこで）**
  - どの地域でサービスを提供しているのか？
  - 最初は都道府県単位が望ましい
  - 例：高知県、東京都
- ** Why（なぜ）**
  - なぜ頼んだ方が良いのか？頼む理由は？
  - 例：満足度95％、特典、安心保証
- ** Who（誰が）**
  - 誰が対応してくれるのか？
  - 例：作業実績10年以上のプロ
- ** How to（どのように）**
  - どのように問い合わせするのか？
  - 例：電話、メール、LINE
- ** How much（いくらで）**
  - いくらからサービスを提供しているのか？（具体的な金額の提示）
  - 安さを売りにしない為、「地域最安」「激安」「最安値」など同類の単語は使用しない
  - 例：10万円～、最大20%削減

## ** ユーザーから入力された見出しでHow muchが無い場合は、以下のカテゴリを参考に推奨金額目安を必ず見出しに入れる **
### カテゴリ | サービス内容 | 推奨金額目安
- 不用品回収（軽トラ積み放題）| 積み放題・即日回収 | 8,000円〜 or 9,800円〜
- 不用品回収（単品・少量）| 小型家具・家電回収など | 3,000円〜 or 4,980円〜
- 解体工事（家・倉庫・小規模）| 木造家屋・倉庫など | 29.8万円〜 or 30万円〜
- 解体工事（大規模・ビル等） | ビル・中規模以上 | 80万円〜 or 98万円〜
- エアコンクリーニング | 1台清掃・簡易タイプ | 7,000円〜 or 8,000円〜
- ハウスクリーニング（キッチン・セット）| キッチン・水回りセット等 | 15,000円〜 or 19,800円〜
- ハウスクリーニング（定期契約）| 月1回〜 | 8,000円〜 or 10,000円〜
- 雨漏り修理 | 原因特定・簡易修理 | 15,000円〜 or 20,000円〜
- 害虫・害獣駆除（小規模）| ハチの巣・ネズミなど | 10,000円〜 or 15,000円〜
- 屋根・外壁修理（部分補修）| 簡易補修・部分施工 | 30,000円〜 or 49,800円〜
- 庭の手入れ・草刈り・剪定 | 除草・枝切りなど | 5,000円〜 or 8,000円〜
- 網戸張替え | 1枚〜数枚程度 | 3,000円〜 or 4,000円〜
- 鍵交換・鍵開け | 玄関・室内ドア等 | 8,000円〜 or 9,800円〜
- 水回り修理 | 水漏れ・詰まりなど | 5,000円〜 or 7,000円〜
- 遺品整理 | 少量・1部屋程度 | 30,000円〜 or 49,800円〜
- 引越し・便利屋手伝い（軽作業）| 荷物運び・家具移動など | 3,000円〜 or 5,000円〜
- ゴミ屋敷清掃 | 部分清掃〜1R程度 | 50,000円〜 or 79,800円〜

## 上記のカテゴリに ** Where（どこで）+ What（何を）+ How much（いくらで）** が最低1個入っている
- 例：奈良密着 9,800円〜 不用品回収

# 手順
1. 出力前に kw 出現回数をカウントし、制約条件に違反していれば修正する。
2. 制約条件に違反していないなら、以下フォーマットで返す。

# 出力形式（見出し15個、説明文4個）
🔸見出し
1. 福島密着 解体費用30万円～
2. 家の解体相場は地域別で確認
3. 解体工事の費用を比較し最適
4. 迅速対応の解体見積り無料
5. 20万円〜 安心の解体サービス
6. 補助金活用でコスト削減
7. 解体業者選びは地域密着
8. 安心施工の解体専門業者
9. 解体費用の適正価格を提案
10. すぐにわかる解体シミュレーション
11. 施工実績豊富な解体業者
12. 30秒で簡単見積もり可能
13. 県内最適解体プラン提案
14. アスベスト対応もお任せ
15. 施工後の廃材処分も安心

🔸説明文
1. 無料見積りと現地調査ですぐに解体費用の目安を提示します。安心のサポート体制でお任せください。
2. 全国対応、補助金申請も無料でサポート。優良解体業者2,000社から最適なプランをご提案します。
3. 30秒の簡単シミュレーションでおおよその費用を把握。しつこい営業電話は一切ありません。
4. 9割以上の方が30万円以上のコスト削減に成功。スピーディな対応と高い満足度をお約束します。
`.trim();

const AD_COPY_FINISHING_PROMPT_TEMPLATE = `
# 役割
Google広告のコピーライティングプロフェッショナル

## 事業者情報の活用
以下の登録済み事業者情報を広告修正に活用してください：

### プロフィール情報
- サービス内容: {{service}}
- 会社名: {{company}}
- 所在地: {{address}}
- 営業時間: {{businessHours}}
- 電話番号: {{tel}}
- 保有資格: {{qualification}}
- 決済方法: {{payments}}

### サービス内容（5W2H）
- 強み: {{strength}}
- いつ: {{when}}
- どこで: {{where}}
- 誰が: {{who}}
- なぜ: {{why}}
- 何を: {{what}}
- どのように: {{how}}
- いくらで: {{price}}

### ペルソナ情報
- ターゲット: {{persona}}

# 目的
ユーザーから入力されたGoogle広告の見出し及び説明文を、指示に従って修正して以下の条件に従ったコピーにしてください。
** 出現させたいメインkwの指示があれば、その指示を優先してコピーを作成してください。 **

# 条件
kw = キーワード
## 魅力的なコピーの定義
### 5W2Hが抑えられている
- ** What（何を）**
  - 何のサービスを提供しているのか？
  - 参入市場で使われているkw
  - 例：庭木剪定、不用品回収
- ** When（いつ）**
  - いつ営業しているのか？
    - 休みはいつ？時間は？
  - 例：年中無休、祝日も営業
- ** Where（どこで）**
  - どの地域でサービスを提供しているのか？
  - 最初は都道府県単位が望ましい
  - 例：高知県、東京都
- ** Why（なぜ）**
  - なぜ頼んだ方が良いのか？頼む理由は？
  - 例：満足度95％、特典、安心保証
- ** Who（誰が）**
  - 誰が対応してくれるのか？
  - 例：作業実績10年以上のプロ
- ** How to（どのように）**
  - どのように問い合わせするのか？
  - 例：電話、メール、LINE
- ** How much（いくらで）**
  - いくらからサービスを提供しているのか？（具体的な金額の提示）
  - 安さを売りにしない為、「地域最安」「激安」「最安値」など同類の単語は使用しない
  - 例：〇円～、最大20%削減

## 分類カテゴリ
### 1. 物販系（販売・通販・ショップ・専門店）
* パターン：名詞 + 販売／通販／ショップ／専門店
* 例：釣具 販売、ミニカー ショップ、登山靴 専門店

### 2. サービス業（地域名＋名詞）
* パターン：名詞 + 地域（東京、大阪、名古屋 など）
* 例：家庭教師 東京、整体 名古屋

### 3. 悩み系（悩み解決ニーズ）
* パターン：名詞 + 悩み
* 例：子育て 悩み、毛深い 悩み、職場 悩み

### 4. 欲望・行動系
* パターン：名詞 + 行動ワード（処分／回収／相談／代行／駆除／測定／塗り替え／取付 など）
* 例：不用品 処分、生命保険 相談、エアコン 取付

### 5. お金系
* パターン：名詞 + 金額関連ワード（料金／価格／費用／相場／格安）
* 例：エステ 料金、親子留学 アメリカ

### 6. クリティカルキーワード（Doクエリ）
* パターン：名詞 + 動詞
* 例：レストラン 予約、Mac 修理、弁護士 相談

## 作成する絶対条件
- ** 見出し **：最大全角15文字以内
- ** 説明文 **：全角40文字以上、45文字以内
- 以下の単語を含むワード及び記号は使用しない
・一括
・比較
・相場
・費用
・最安
・安い
・シミュレーション
・値引
・どのくらい
・いくら
・【】
・？
・！
`.trim();

const LP_DRAFT_PROMPT_TEMPLATE = `
# あなたは、Google広告で使用された「広告見出し」と「広告説明文」から、スマホ最適化されたLPドラフトを構成的に自動生成する専門ライターです。

## 事業者情報の活用
以下の登録済み事業者情報をLP作成に活用してください：

### プロフィール情報
- サービス内容: {{service}}
- 会社名: {{company}}
- 所在地: {{address}}
- 代表者名: {{ceo}}
- 営業時間: {{businessHours}}
- 電話番号: {{tel}}
- 保有資格: {{qualification}}
- メールアドレス: {{email}}
- 決済方法: {{payments}}

### サービス内容（5W2H）
- 強み: {{strength}}
- いつ: {{when}}
- どこで: {{where}}
- 誰が: {{who}}
- なぜ: {{why}}
- 何を: {{what}}
- どのように: {{how}}
- いくらで: {{price}}

### ペルソナ情報
- ターゲット: {{persona}}

### 参考情報
- 競合広告文: {{competitorCopy}}
- ベンチマークURL: {{benchmarkUrl}}

## ユーザーから入力された広告情報に基づき、CV率を高める一貫性のあるLPを、以下の16パート構成で出力してください。

# 注意事項
- ユーザーが入力した広告見出しと説明文を必ず活用してください
- 上記の事業者情報と一貫性を保ってください
- 競合広告文は参考程度に留め、独自性を重視してください

# 出力条件
1. ユーザーの約8～9割がスマホ閲覧する前提で、読みやすくテンポの良い文章構成にすること。
2. ファーストビューでは、ユーザー入力の広告見出し・説明文と完全に一致するワードを盛り込み、「地域名＋サービス名＋特典」を明示すること。
3. ファーストビューには、5W2H（誰が・いつ・どこで・なぜ・何を・どのように・いくらで）を意識すること。
4. 限定性（「今だけ」「先着〇名」「月末まで」など）を常に意識して書くこと。
5. テキストベースのLP構成ドラフトとして、以下16パートを順番に出力すること。

# LP構成パート
1. 心をつかむパート（キャッチコピー＋サブ）
2. 特典パート（限定感、今だけ）
3. 共感・問題提起（こんなお悩みありませんか？）
4. 解決方法提示（サービス概要）※価格はここで書かない
5. お客様の声・導入事例（リアルで信頼性高く）
6. 特徴・選ばれる理由（差別化ポイント最大6つ）
7. ベネフィット（あなたに頼むとどうなるか）
8. こんな人におすすめ（自分ごと化）
9. 自己紹介・プロフィール（親近感）
10. メッセージ（あなたに伝えたいこと）
11. 商品説明（具体的な内容）
12. 価格パート（価格とその理由・オプション）
13. よくある質問（5W2Hに沿って）
14. CTA（お問い合わせ方法と安心感）
15. 支払い方法・キャンセル・特商法
16. 最後に（想い・社会的意義など）

# 出力形式
- LP構成パートのまま出力してください。
- 各パートは見出し付きで、誰でも分かりやすく使えるドラフト形式にしてください。
`.trim();

// 後方互換性のため従来のプロンプトも残す
const LP_DRAFT_PROMPT = LP_DRAFT_PROMPT_TEMPLATE;

// =============================================================================
// プロンプト生成関数（React Cache活用）
// =============================================================================

/**
 * 広告コピー作成用プロンプト生成（キャッシュ付き）
 * DBからprompt_templatesテーブルを取得するように変更
 */
const generateAdCopyPrompt = cache(
  async (liffAccessToken: string, serviceId?: string): Promise<string> => {
    try {
      // DBからプロンプトテンプレートを取得
      const template = await PromptService.getTemplateByName('ad_copy_creation');
      if (!template) {
        console.warn(
          'ad_copy_creation プロンプトテンプレートが見つかりません - 静的テンプレートを使用'
        );
        const businessInfo = await getCachedBrief(liffAccessToken);
        return replaceTemplateVariables(AD_COPY_PROMPT_TEMPLATE, businessInfo, serviceId);
      }

      const businessInfo = await getCachedBrief(liffAccessToken);
      return replaceTemplateVariables(template.content, businessInfo, serviceId);
    } catch (error) {
      console.error('広告コピープロンプト生成エラー:', error);
      // フォールバック: 静的テンプレートを返す
      try {
        const businessInfo = await getCachedBrief(liffAccessToken);
        return replaceTemplateVariables(AD_COPY_PROMPT_TEMPLATE, businessInfo, serviceId);
      } catch (fallbackError) {
        console.error('フォールバックプロンプト生成エラー:', fallbackError);
        return AD_COPY_PROMPT_TEMPLATE;
      }
    }
  }
);

/**
 * 広告コピー仕上げ用プロンプト生成（キャッシュ付き）
 */
const generateAdCopyFinishingPrompt = cache(
  async (liffAccessToken: string, serviceId?: string): Promise<string> => {
    try {
      // DBからプロンプトテンプレートを取得
      const template = await PromptService.getTemplateByName('ad_copy_finishing');
      if (!template) {
        console.warn('ad_copy_finishing プロンプトテンプレートが見つかりません');
        return AD_COPY_FINISHING_PROMPT_TEMPLATE;
      }

      const businessInfo = await getCachedBrief(liffAccessToken);
      return replaceTemplateVariables(template.content, businessInfo, serviceId);
    } catch (error) {
      console.error('広告コピー仕上げプロンプト生成エラー:', error);
      // フォールバック: 元のテンプレートを返す
      return AD_COPY_FINISHING_PROMPT_TEMPLATE;
    }
  }
);

/**
 * LP下書き作成用プロンプト生成（キャッシュ付き）
 * DBからprompt_templatesテーブルを取得するように変更
 */
const generateLpDraftPrompt = cache(
  async (liffAccessToken: string, serviceId?: string): Promise<string> => {
    try {
      // DBからプロンプトテンプレートを取得
      const template = await PromptService.getTemplateByName('lp_draft_creation');
      if (!template) {
        console.warn(
          'lp_draft_creation プロンプトテンプレートが見つかりません - 静的テンプレートを使用'
        );
        const businessInfo = await getCachedBrief(liffAccessToken);
        return replaceTemplateVariables(LP_DRAFT_PROMPT_TEMPLATE, businessInfo, serviceId);
      }

      const businessInfo = await getCachedBrief(liffAccessToken);
      return replaceTemplateVariables(template.content, businessInfo, serviceId);
    } catch (error) {
      console.error('LP下書きプロンプト生成エラー:', error);
      // フォールバック: 静的テンプレートを返す
      try {
        const businessInfo = await getCachedBrief(liffAccessToken);
        return replaceTemplateVariables(LP_DRAFT_PROMPT_TEMPLATE, businessInfo, serviceId);
      } catch (fallbackError) {
        console.error('フォールバックプロンプト生成エラー:', fallbackError);
        return LP_DRAFT_PROMPT_TEMPLATE;
      }
    }
  }
);

/**
 * 見出し単位生成用の最小プロンプト（DBテンプレート不使用）
 * Step 6（書き出し案/旧見出しフロー）および Step 7（本文作成/新見出しフロー）で使用。
 * 事業者情報とコンテンツ変数のみで構成し、見出し構成の混在による混乱を防ぐ。
 */
async function generateHeadingUnitPrompt(
  liffAccessToken: string,
  sessionId: string,
  activeSection: { heading_text: string; heading_level?: number }
): Promise<string> {
  try {
    const [auth, businessInfo] = await Promise.all([
      authMiddleware(liffAccessToken),
      getCachedBrief(liffAccessToken),
    ]);
    const userId = auth.error ? undefined : auth.userId;
    const contentAnnotation = userId
      ? sessionId
        ? await PromptService.getContentAnnotationBySession(userId, sessionId)
        : await PromptService.getLatestContentAnnotationByUserId(userId)
      : null;
    const contentVars = PromptService.buildContentVariables(contentAnnotation ?? null);

    const lines: string[] = [
      '# 役割',
      'ブログ記事の見出し本文を書く専門家です。指定された1見出し分の本文のみを出力します。',
      '',
      '# コンテキスト',
      '事業者・サービス、キーワード、ターゲットに沿って一貫性のある本文を書いてください。',
    ];

    if (businessInfo) {
      const profile = businessInfo.profile;
      const service = businessInfo.services?.[0];
      lines.push(
        '',
        '## 事業者情報',
        `- 会社・サービス: ${profile?.company ?? ''} / ${service?.name ?? ''}`
      );
      if (businessInfo.persona) {
        lines.push(`- ターゲット: ${businessInfo.persona}`);
      }
    }

    if (
      contentVars.contentMainKw ||
      contentVars.contentKw ||
      contentVars.contentGoal ||
      contentVars.contentPersona ||
      contentVars.contentNeeds ||
      contentVars.contentPrep
    ) {
      lines.push('', '## キーワード・記事方針');
      if (contentVars.contentMainKw) lines.push(`- メインKW: ${contentVars.contentMainKw}`);
      if (contentVars.contentKw) lines.push(`- KW: ${contentVars.contentKw}`);
      if (contentVars.contentGoal) lines.push(`- ユーザーゴール: ${contentVars.contentGoal}`);
      if (contentVars.contentPersona)
        lines.push(`- デモグラ・ペルソナ: ${contentVars.contentPersona}`);
      if (contentVars.contentNeeds) lines.push(`- ニーズ: ${contentVars.contentNeeds}`);
      if (contentVars.contentPrep) lines.push(`- PREP構成（参考）: ${contentVars.contentPrep}`);
    }

    const contextBlock = lines.filter(Boolean).join('\n');

    const headingLevel = activeSection.heading_level ?? 3;
    const hashes = '#'.repeat(headingLevel);

    const headingConstraintBlock = [
      '',
      '---',
      '',
      '## 【最重要】見出し単位生成モード',
      '',
      `**対象見出し（これのみ出力）**: 「${activeSection.heading_text}」`,
      '',
      '**絶対ルール**:',
      '- ユーザーへの確認・質問は不要です。上記の対象見出しの「見出し行＋本文」を即座に出力してください。',
      '- 「どの見出しを書くか」等の確認メッセージは絶対に出力しないでください。',
      '- 【主な修正内容】「追加 -」「変更 -」「削除 -」などの修正分析・変更箇所の説明は絶対に出力しないでください。見出し＋本文のみを出力してください。',
      `- 出力は「見出し行＋本文」の形式にしてください。1行目に ${hashes} レベルで見出し行を書き、2行目を空行、3行目以降に本文を書いてください。`,
      '- 他の見出し、全体構成、前後のセクション、タイトル、リード文などは絶対に出力しないでください。',
      '',
      '出力形式の例:',
      '```',
      `${hashes} ${activeSection.heading_text}`,
      '',
      '（ここに本文。200〜400字程度を目安）',
      '```',
    ].join('\n');

    return contextBlock + headingConstraintBlock;
  } catch (error) {
    console.error('Step6見出し単位プロンプト生成エラー:', error);
    return SYSTEM_PROMPT;
  }
}

/**
 * ブログ作成用プロンプト生成（キャッシュ付き）
 * DBテンプレート + canonicalUrls 変数埋め込み
 */
async function generateBlogCreationPromptByStep(
  liffAccessToken: string,
  step: BlogStepId,
  sessionId?: string
): Promise<string> {
  try {
    const templateName = toTemplateName(step);
    if (process.env.NODE_ENV === 'development') {
      console.log('[BlogPrompt] Fetching step template', { step, templateName });
    }

    const [template, auth, businessInfo] = await Promise.all([
      PromptService.getTemplateByName(templateName),
      authMiddleware(liffAccessToken),
      getCachedBrief(liffAccessToken),
    ]);

    const userId = auth.error ? undefined : auth.userId;
    const isStep7 = isBlogStep7(step); // 現step7を本文作成として扱う
    const canonicalLinkEntries =
      isStep7 && userId ? await PromptService.getCanonicalLinkEntriesByUserId(userId) : [];
    const canonicalUrls = canonicalLinkEntries.map(entry => entry.canonical_url);
    const canonicalLinkPairsFormatted = canonicalLinkEntries.map(entry => {
      const title = entry.wp_post_title || '';
      return title ? `${title} | ${entry.canonical_url}` : entry.canonical_url;
    });
    if (isStep7) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[BlogPrompt] Step7 canonicalUrls loaded', {
          step,
          templateName,
          userIdLoaded: Boolean(userId),
          canonicalUrlCount: canonicalUrls.length,
        });
      }
    }
    // DBテンプレの変数定義と本文内のプレースホルダを可視化
    const dbVarNames = (template?.variables || []).map(v => v.name);
    const contentVarNames = Array.from(
      new Set(
        ((template?.content || '').match(/\{\{(\w+)\}\}/g) || []).map(m => m.replace(/[{}]/g, ''))
      )
    );
    const varsDiff = {
      missingInDB: contentVarNames.filter(n => !dbVarNames.includes(n)),
      extraInDB: dbVarNames.filter(n => !contentVarNames.includes(n)),
    };
    if (process.env.NODE_ENV === 'development') {
      console.log('[BlogPrompt][Vars] テンプレ変数確認', {
        step,
        templateName,
        isStep7,
        dbVarNames,
        contentVarNames,
        varsDiff,
      });
    }
    // content_annotations を取得（セッション優先、無ければユーザー最新）し、テンプレ変数としてマージ
    const contentAnnotation = userId
      ? sessionId
        ? await PromptService.getContentAnnotationBySession(userId, sessionId)
        : await PromptService.getLatestContentAnnotationByUserId(userId)
      : null;
    const contentVars = PromptService.buildContentVariables(contentAnnotation);

    // コンテンツ変数は全ステップで適用。canonicalUrls はStep7のみ適用
    const vars: Record<string, string> = isStep7
      ? {
          ...contentVars,
          canonicalUrls: canonicalUrls.join('\n'),
          canonicalLinkPairs: canonicalLinkPairsFormatted.join('\n'),
        }
      : { ...contentVars };
    if (process.env.NODE_ENV === 'development') {
      console.log('[BlogPrompt][Vars] 置換に使用する変数ソース', {
        step,
        isStep7,
        applyBusinessInfo: true,
        applyContentVars: true,
        contentVarsKeys: Object.keys(contentVars),
        canonicalUrlCount: canonicalUrls.length,
      });
    }

    if (template?.content) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[BlogPrompt] Using step template from DB', {
          step,
          templateName,
          withVariables: isStep7,
          contentLength: template.content.length,
        });
      }
      // 1) 事業者情報（{{...}}）を置換 → 2) コンテンツ/Step7変数を置換
      // ブログ作成は今のところ特定のサービスに依存しない（全体Profileを使用）
      const afterBusiness = replaceTemplateVariables(template.content, businessInfo);
      const mergedPrompt = PromptService.replaceVariables(afterBusiness, vars);
      const unresolvedPlaceholders = (mergedPrompt.match(/{{(\w+)}}/g) || []).map(token =>
        token.replace(/[{}]/g, '')
      );

      if (unresolvedPlaceholders.length > 0) {
        console.warn('[BlogPrompt] 未解決のDBプロンプト変数を検出 - 空文字で置換', {
          step,
          templateName,
          unresolvedPlaceholders,
        });
        if (process.env.NODE_ENV === 'development') {
          return mergedPrompt.replace(/{{\w+}}/g, match => `[未解決: ${match}]`);
        }
        // TODO: エラートラッキングサービスに送信
        return mergedPrompt.replace(/{{\w+}}/g, '');
      }

      return mergedPrompt;
    }

    console.warn('[BlogPrompt] Step template not found. Using SYSTEM_PROMPT as fallback', {
      step,
      templateName,
      withVariables: isStep7,
    });
    return SYSTEM_PROMPT;
  } catch (error) {
    console.error('ブログ作成ステッププロンプト生成エラー:', error);
    return SYSTEM_PROMPT;
  }
}

// =============================================================================
// 共通：モデル別システムプロンプト解決
// =============================================================================

const STATIC_PROMPTS: Record<string, string> = {
  'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2': KEYWORD_CATEGORIZATION_PROMPT,
  ad_copy_creation: AD_COPY_PROMPT,
  ad_copy_finishing: AD_COPY_FINISHING_PROMPT,
  lp_draft_creation: LP_DRAFT_PROMPT,
};
const BLOG_STEP_PATTERN = new RegExp(`^blog_creation_(${BLOG_STEP_IDS.join('|')})(?:_|$)`);

/**
 * モデルに応じたシステムプロンプトを取得する（LIFFトークンがあれば動的生成、なければ静的）
 */
export async function getSystemPrompt(
  model: string,
  liffAccessToken?: string,
  sessionId?: string,
  serviceIdOverride?: string
): Promise<string> {
  if (liffAccessToken) {
    // セッションに紐づくサービスIDを解決（オーバーライドがなければ）
    let serviceId = serviceIdOverride;
    let authUserId: string | null = null;
    if (sessionId) {
      const authResult = await authMiddleware(liffAccessToken);
      if (!authResult.error && authResult.userId) {
        authUserId = authResult.userId;
      }
      if (!serviceId && authUserId) {
        const result = await supabaseService.getSessionServiceId(sessionId, authUserId);
        if (result.success && result.data) serviceId = result.data;
      }
    }

    if (model.startsWith('blog_creation_')) {
      const stepMatch = model.match(BLOG_STEP_PATTERN);
      if (!stepMatch?.[1]) {
        return STATIC_PROMPTS[model] ?? SYSTEM_PROMPT;
      }
      const step = stepMatch[1] as BlogStepId;

      // 見出し構成・本文作成ステップ (Step 7): 見出し単位生成モードの判定
      // 該当時は固有の生成プロンプトのみを返し、DBテンプレートの取得等を回避する
      if (isBlogStep7(step) && sessionId && authUserId) {
        const sessionRes = await supabaseService.getChatSessionById(sessionId, authUserId);
        if (sessionRes.success && sessionRes.data) {
          const sectionsResult = await headingFlowService.getHeadingSections(sessionId);
          if (sectionsResult.success && Array.isArray(sectionsResult.data)) {
            const activeSection = sectionsResult.data.find(s => !s.is_confirmed);
            if (activeSection) {
              return generateHeadingUnitPrompt(liffAccessToken, sessionId, activeSection);
            }
          }
        }
      }

      // 通常のステッププロンプト生成
      const basePrompt = await generateBlogCreationPromptByStep(liffAccessToken, step, sessionId);

      // Step 7 (最終生成モード): 既存本文があればコンテキストとして追加する (必須ではない)
      if (isBlogStep7(step) && sessionId && authUserId) {
        const [latestCombinedResult, legacyStep6Result] = await Promise.all([
          supabaseService.getLatestCombinedContentBySession(sessionId, authUserId),
          supabaseService.getLatestAccessibleAssistantMessageBySessionAndModel(
            sessionId,
            authUserId,
            'blog_creation_step6'
          ),
        ]);

        if (latestCombinedResult.success && latestCombinedResult.data?.trim()) {
          return [
            basePrompt,
            '',
            '## 現在の本文内容',
            '以下の内容を正本として、指示に従って更新または追加してください。',
            latestCombinedResult.data,
          ].join('\n');
        }

        if (legacyStep6Result.success && legacyStep6Result.data?.content?.trim()) {
          return [
            basePrompt,
            '',
            '## 現在の本文内容 (移行データ)',
            '以下の内容を正本として、指示に従って更新または追加してください。',
            legacyStep6Result.data.content,
          ].join('\n');
        }
      }

      return basePrompt;
    }
    switch (model) {
      case 'ad_copy_creation':
        return await generateAdCopyPrompt(liffAccessToken, serviceId);
      case 'ad_copy_finishing':
        return await generateAdCopyFinishingPrompt(liffAccessToken, serviceId);
      case 'lp_draft_creation':
        return await generateLpDraftPrompt(liffAccessToken, serviceId);
      default:
        return STATIC_PROMPTS[model] ?? SYSTEM_PROMPT;
    }
  }

  return STATIC_PROMPTS[model] ?? SYSTEM_PROMPT;
}
