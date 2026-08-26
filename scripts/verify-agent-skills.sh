#!/usr/bin/env bash
# GrowMate Agent Skills 静的検証（Codex / Claude Code / Cursor 共通の .agents/skills 正本）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warnings=0

fail() { echo -e "${RED}✗${NC} $1"; errors=$((errors + 1)); }
warn() { echo -e "${YELLOW}!${NC} $1"; warnings=$((warnings + 1)); }
ok()   { echo -e "${GREEN}✓${NC} $1"; }

EXPECTED_SKILLS=(
  google-integrations
  growmate-ui-ux
  implementation-guidelines
  llm-context-memory
  nextjs-server
  project-naming
  quality-gate
  react
  spec-review
  spec-to-html
  supabase
  update-docs
)

extract_frontmatter_field() {
  local file="$1"
  local field="$2"
  awk -v field="$field" '
    /^---$/ { n++; next }
    n == 1 && $0 ~ "^" field ":" {
      sub("^" field ":[[:space:]]*", "")
      print
      exit
    }
  ' "$file"
}

echo "=== GrowMate Agent Skills 検証 ==="
echo "ROOT: $ROOT"
echo

echo "--- Symlinks ---"
for link in .claude/skills .codex/agents .claude/agents; do
  if [[ -L "$link" ]]; then
    target="$(readlink "$link")"
    ok "$link -> $target"
  else
    fail "$link が symlink ではない"
  fi
done

if [[ "$(readlink .claude/skills)" == "../.agents/skills" ]]; then
  ok ".claude/skills の参照先が正しい"
else
  fail ".claude/skills の参照先が ../.agents/skills ではない"
fi

for agents_link in .codex/agents .claude/agents; do
  if [[ "$(readlink "$agents_link")" == "../.agents/agents" ]]; then
    ok "$agents_link の参照先が正しい"
  else
    fail "$agents_link の参照先が ../.agents/agents ではない"
  fi
done
echo

echo "--- Core files ---"
if [[ -f CLAUDE.md && ! -L CLAUDE.md ]]; then
  ok "CLAUDE.md が正本ファイル"
else
  fail "CLAUDE.md が正本ファイルではない"
fi

if [[ -L AGENTS.md && "$(readlink AGENTS.md)" == "CLAUDE.md" ]]; then
  ok "AGENTS.md -> CLAUDE.md"
else
  fail "AGENTS.md が CLAUDE.md への symlink ではない"
fi

if cmp -s AGENTS.md CLAUDE.md; then
  ok "AGENTS.md と CLAUDE.md の内容が一致"
else
  fail "AGENTS.md と CLAUDE.md の内容が不一致"
fi
echo

echo "--- Agent hooks ---"
for hook_config in .claude/settings.json .codex/hooks.json; do
  if [[ -f "$hook_config" ]] && grep -Fq "scripts/spec-html-hook.sh" "$hook_config"; then
    ok "$hook_config が共通HTMLフックを参照"
  else
    fail "$hook_config が scripts/spec-html-hook.sh を参照していない"
  fi
done
if [[ -x scripts/spec-html-hook.sh ]]; then
  ok "scripts/spec-html-hook.sh が実行可能"
else
  fail "scripts/spec-html-hook.sh が存在しないか実行不可"
fi
echo

echo "--- SKILL.md 走査 ---"
skill_files=()
while IFS= read -r line; do
  skill_files+=("$line")
done < <(find .agents/skills -mindepth 2 -maxdepth 2 -name 'SKILL.md' | sort)
ok "SKILL.md 件数: ${#skill_files[@]}"

names_file="$(mktemp)"
trap 'rm -f "$names_file"' EXIT

for skill_file in "${skill_files[@]}"; do
  name="$(extract_frontmatter_field "$skill_file" "name")"
  desc="$(extract_frontmatter_field "$skill_file" "description")"

  if [[ -z "$name" ]]; then
    fail "$skill_file: frontmatter name がありません"
    continue
  fi
  if [[ -z "$desc" ]]; then
    fail "$skill_file: frontmatter description がありません"
    continue
  fi

  if grep -qx "$name" "$names_file" 2>/dev/null; then
    prev="$(grep -F "$name|" "$names_file" | head -1 | cut -d'|' -f2-)"
    fail "name 重複: $name ($prev と $skill_file)"
  else
    echo "$name" >> "$names_file"
    echo "$name|$skill_file" >> "${names_file}.paths"
    ok "$name ($skill_file)"
  fi
done
echo

echo "--- 期待 Skill セット ---"
for expected in "${EXPECTED_SKILLS[@]}"; do
  if grep -qx "$expected" "$names_file" 2>/dev/null; then
    ok "期待 Skill 存在: $expected"
  else
    fail "期待 Skill 不足: $expected"
  fi
done

while IFS='|' read -r name path; do
  [[ -z "$name" ]] && continue
  found=false
  for expected in "${EXPECTED_SKILLS[@]}"; do
    if [[ "$name" == "$expected" ]]; then
      found=true
      break
    fi
  done
  if [[ "$found" == false ]]; then
    warn "想定外 Skill: $name ($path)"
  fi
done < "${names_file}.paths" 2>/dev/null || true
echo

echo "--- TAKT ワークフロー ---"
for workflow in .takt/workflows/grill-to-gherkin.yaml .takt/workflows/spec-review.yaml .takt/workflows/spec-to-pr.yaml; do
  if [[ -f "$workflow" ]]; then
    ok "$workflow"
  else
    fail "TAKT workflow 不足: $workflow"
  fi
done

for removed in .agents/skills/spec-to-pr .agents/skills/react-doctor-to-pr .agents/skills/shared/pr-workflows; do
  if [[ -e "$removed" ]]; then
    fail "削除済みであるべき旧PR Skillパスが残っています: $removed"
  else
    ok "旧PR Skillパス削除済み: $removed"
  fi
done

if TAKT_BIN="$(./scripts/resolve-takt-bin.sh)"; then
  if "${TAKT_BIN}" workflow doctor .takt/workflows/grill-to-gherkin.yaml .takt/workflows/spec-review.yaml .takt/workflows/spec-to-pr.yaml >/dev/null; then
    ok "TAKT workflow doctor (${TAKT_BIN})"
  else
    fail "TAKT workflow doctor failed (${TAKT_BIN})"
  fi
else
  fail "TAKT pin 未解決（./scripts/takt-install-pinned.sh を実行。正本: .takt-version）"
fi
echo

echo "--- Subagent 正本 ---"
for f in .agents/agents/client-alignment-auditor.toml .agents/agents/client-alignment-auditor.md; do
  if [[ -f "$f" ]]; then
    ok "$f"
  else
    fail "Subagent 不足: $f"
  fi
done
echo

echo "=== 結果 ==="
echo "errors: $errors / warnings: $warnings"
rm -f "${names_file}.paths"

if [[ "$errors" -gt 0 ]]; then
  echo
  echo "静的検証 NG。修正後に再実行: npm run verify:agent-skills"
  exit 1
fi

echo
echo "静的検証 OK。"
echo
echo "=== 実行時テスト（手動）==="
echo "Codex CLI:"
echo "  cd $ROOT && codex"
echo "  > /skills"
echo "  > 「このリポジトリの Skill 正本パスは？」"
echo
echo "Claude Code:"
echo "  cd $ROOT && claude"
echo "  > /skills"
echo "  > 「このリポジトリの Skill 正本パスは？」"
echo
echo "Cursor:"
echo "  Agent チャットで「このリポジトリの Skill 正本パスは？」"
exit 0
