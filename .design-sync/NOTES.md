# design-sync NOTES（GrowMate）

## 構成
- GrowMate はアプリで dist/ も .d.ts も無い。`node .design-sync/build.mjs`（buildCmd）が `.design-sync/.cache/pkg/` に部品だけの小さなパッケージ（`growmate-ui`）を組み立てる。中身は barrel の entry.ts、tsc の .d.ts、Tailwind v4 でコンパイルした growmate.css。
- 変換は `--entry ./.design-sync/.cache/pkg/entry.ts --node-modules ./node_modules`。config のパスは PKG_DIR（`.design-sync/.cache/pkg`）基準なので `../../../src/...` になる。
- リポジトリ直下に `types/` があるため、パッケージをリポジトリ直下に置くと変換の findTypesRoot がそこを .d.ts の置き場と誤認し、props が空になる。小さなパッケージに分けたのはこのため。
- lucide-react は Table・Badge など部品と同名のアイコンを export するので、`Icons` 名前空間で出している（`componentSrcMap.Icons = null` でカード化しない）。
- CSS はリポジトリ全体の使用クラスから Tailwind が生成する。`.design-sync/` の md と previews も走査されるので、ここに書いたクラス名は CSS に入る。アプリでも `.design-sync/` でも使っていないクラスは存在しない。conventions.md にその旨を書いてある。
- フォントは本番と同じ Inter（latin）を Google Fonts から読む（`runtimeFontPrefixes: ["Inter"]`）。日本語は OS フォント。

## 見本
- 見本は src/components/ui の19部品だけ（2026-10-25 の依頼範囲）。CardHeader などのサブ部品34件は floor card のまま。親の見本の中で使い方を示している。
- Alert はアプリの多くの箇所でアイコンを付けていない（`alert.tsx` にアイコン用の配置スタイルが無い）ので、見本にも付けない。

## Known render warns
- なし（2026-10-25 時点で render check 53/53 clean）。

## Re-sync risks
- `src/components/ui` に部品を足したら `componentSrcMap` に足し、見本を書く。build.mjs の barrel は ui/ のファイルを自動で拾うが、カード化は componentSrcMap だけで決まる。
- growmate.css はリポジトリ全体のクラスから作るため、アプリのコード変更だけで CSS が変わる。再同期で styling の差分が出るのは正常。
- Google Fonts の Inter はネットワーク経由。オフラインの検証では Inter にならない。
- tsc のバージョンや tsconfig の変更で .d.ts の形が変わると、props の出力が変わる。
