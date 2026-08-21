レビュー対象の仕様書を特定し、適用する観点を決定してください。

必須手順:
1. ユーザー指示から対象仕様書（`docs/plans/` 配下）を特定する。曖昧な場合は `docs/plans/` を列挙し、候補を示して ABORT する。
2. `.agents/skills/spec-review/SKILL.md` を読む。
3. `docs/templates/requirement-definition.md` を要件定義チェックリストとして読む。
4. 対象仕様書を読む。クライアント整合性・曖昧な要件・複数解釈・挙動変更・運用影響・未合意のトレードオフがある場合だけ `docs/context/client-vision-from-lark.md` を読む。純粋な技術仕様、DB・内部実装、または既存の正本で判断できるUI変更では読まない。
5. spec-review skill のルーティング表に従い、対象仕様書に適用する条件付き観点（クライアント整合 / LLM / UI / データ / Google 連携 / 外部サービス連携）を判定し、対応する正本ファイルを列挙する。対象範囲（画面・機能・データ・API）と Non-goals（要件にない画面・UI・機能追加、ついで修正、将来対応）も確定する。
6. 仕様書が対象とする機能の既存実装（`src/server/services/*`、`src/server/actions/*`、関連画面）を grep で把握する。
7. 仕様書が外部サービス（Google / WordPress / Instagram(Meta) / Supabase 等）の API・挙動を前提にしている場合、`.agents/skills/spec-review/external-services.md` の「一次情報検証 > 公式ドキュメントの起点」の URL 表をもとに、audit で **実際に WebFetch して照合すべき公式ドキュメントの URL** を列挙する。仕様書のどの記述をどの URL で検証するかを対応付けて書く。外部サービス連携がない場合は「対象外」と明記する。
