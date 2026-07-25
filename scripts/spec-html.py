#!/usr/bin/env python3
"""docs/plans の仕様書ビュー HTML を、単一の自己完結 HTML に束ねる。

`.agents/skills/spec-to-html/SKILL.md` が正本。本スクリプトは「結合」「全文ビューの生成」
「安全検査」「整合性チェック」を担い、意味を再構成するビュー（01〜03）の内容は生成側の責務とする。

使い方:
    # 全文ビューの生成（原本 Markdown からの決定論的変換。LLM を介さない）
    python3 scripts/spec-html.py fulltext \\
      --spec docs/plans/<slug>.md \\
      --out docs/plans/_html/<slug>/views/04-fulltext.html

    # 結合（結合後に安全検査も自動実行する）
    python3 scripts/spec-html.py build \\
      --out docs/plans/_html/<slug>.html \\
      --title "<仕様書名> — 図解" \\
      --source docs/plans/<slug>.md \\
      --view "ステータスと次の一手=docs/plans/_html/<slug>/views/01-status.html" \\
      --view "設計判断=docs/plans/_html/<slug>/views/02-decisions.html" \\
      --view "クイズ=docs/plans/_html/<slug>/views/03-quiz.html" \\
      --view "全文=docs/plans/_html/<slug>/views/04-fulltext.html"

    # 安全検査のみ
    python3 scripts/spec-html.py check docs/plans/_html/<slug>.html

整合性チェック（`build` に `--source` を渡したときだけ動く）:
    `core.yaml` の source_refs（行番号）と原本を毎回突合し、行番号のズレ・参照先の改訂・
    未参照の章を fail / warn / info として成果物の先頭バーとコンソールに自己申告する。
    基準は `<出力先と同名のディレクトリ>/.snapshot.json`（毎回更新）。前回生成からの
    章の追加・削除・変更も同じバーに出る。**fail が出てもビルドは落とさない**
    （レビューの commit を妨げないため）。落ちるのは下記の安全検査だけ。

設計上の制約（安全検査で強制）:
    生成物はオフラインで自己完結していること。外部スクリプト・外部CSS・ネットワーク通信・
    ブラウザストレージ・cookie・親フレームへのアクセスを含めない。iframe を使わないため
    file:// でそのまま開ける。原本に含まれる URL はスキームを除去して平文表示する
    （リンクにはしない）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ImportError:  # core.yaml を読めないだけで、結合と全文変換は成立する
    yaml = None  # type: ignore[assignment]

# ── 安全検査 ────────────────────────────────────────────────────────────────
# 文書全体に対する検査。マークアップとして書かれた時点で外部依存が発生するもの。
DOC_FORBIDDEN: list[tuple[str, str]] = [
    (r"<script[^>]+\bsrc\s*=", "外部スクリプト読み込み"),
    (r'<link[^>]+rel\s*=\s*["\']?stylesheet', "外部CSS読み込み"),
    (r"@import\s+(?:url\()?['\"]?(?:https?:)?//", "リモート @import"),
    (r"<iframe", "iframe（file:// で読み込めなくなる）"),
    (r"<(?:object|embed)\b", "<object> / <embed>"),
    (r'target\s*=\s*["\']_top["\']', "トップフレームへの遷移"),
    (r"https?://", "外部URL（オフライン自己完結でなくなる）"),
]

# 実行面（<script> 本文と on* 属性）だけに対する検査。
# 全文ビューは仕様書の本文をそのまま収録するため、`localStorage` のような語が
# 「アプリの設計としてそう書かれている」だけの地の文に現れる。テキストノードに
# 現れた語は何も実行しないので、実行され得る箇所だけを見る。
JS_FORBIDDEN: list[tuple[str, str]] = [
    (r"\bfetch\s*\(", "fetch()"),
    (r"\bXMLHttpRequest\b", "XMLHttpRequest"),
    (r"\bWebSocket\b", "WebSocket"),
    (r"\blocalStorage\b", "localStorage"),
    (r"\bsessionStorage\b", "sessionStorage"),
    (r"document\.cookie", "document.cookie"),
    (r"window\.(?:parent|top)\b", "親フレームへのアクセス"),
]

_SCRIPT_RE = re.compile(r"<script\b[^>]*>(.*?)</script>", re.S | re.I)
_HANDLER_RE = re.compile(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*')", re.I)


def check(path: Path) -> int:
    """禁止パターンを走査する。違反があれば行番号付きで報告し、件数を返す。"""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    findings: list[str] = []

    def lineno_of(offset: int) -> int:
        return text.count("\n", 0, offset) + 1

    for pattern, label in DOC_FORBIDDEN:
        rx = re.compile(pattern, re.I)
        for lineno, line in enumerate(lines, 1):
            if rx.search(line):
                findings.append(f"  L{lineno}: {label} — {line.strip()[:110]}")

    # 実行され得る領域（<script> 本文 + インラインイベントハンドラ）を切り出して検査する
    executable: list[tuple[int, str]] = [
        (lineno_of(m.start(1)), m.group(1)) for m in _SCRIPT_RE.finditer(text)
    ]
    executable += [(lineno_of(m.start(1)), m.group(1)) for m in _HANDLER_RE.finditer(text)]

    for base_line, chunk in executable:
        for pattern, label in JS_FORBIDDEN:
            rx = re.compile(pattern)
            for m in rx.finditer(chunk):
                lineno = base_line + chunk.count("\n", 0, m.start())
                findings.append(f"  L{lineno}: {label}（実行面） — {m.group(0)}")

    print(f"== {path} ==")
    if findings:
        for f in findings:
            print(f)
        print(f"  NG: {len(findings)} 件の禁止パターン")
    else:
        print("  OK: 禁止パターンなし（オフライン自己完結）")
    return len(findings)


# ── 結合 ────────────────────────────────────────────────────────────────────
def _grab(pattern: str, text: str, label: str, path: Path) -> str:
    m = re.search(pattern, text, re.S)
    if not m:
        sys.exit(f"{path}: {label} が見つからない")
    return m.group(1)


def _scope(js: str, panel_id: str) -> str:
    """document.querySelector 系だけをパネルのルート要素に差し替える。

    ビューごとに独立した JS を1ファイルへ同居させるため、DOM 探索を自パネル内に閉じる。
    document.documentElement / createElement / body はグローバルのまま残す。
    """
    js = js.replace("document.querySelectorAll(", "__root.querySelectorAll(")
    js = js.replace("document.querySelector(", "__root.querySelector(")
    js = re.sub(
        r"document\.getElementById\((['\"])([^'\"]+)\1\)",
        r"__root.querySelector('#\2')",
        js,
    )
    return f"var __root = document.getElementById('{panel_id}');\n{js}"


# ── 矢じりマーカーの共有 ──────────────────────────────────────────────────
# ビューを1文書に束ねると CSS が連結され、同名クラス（.e など）は「後勝ち」になる。
# 各ビューが独自の marker ID を持つと、後のビューの marker-end が前のビューにも適用され、
# 前のビューの矢印が「hidden なパネル内の marker」を指して消える。
# そこで ID を1組に正規化し、defs をパネルの外に1つだけ置く。
MARKER_IDS = ("ah", "ah-red", "ah-grn", "ah-acc")

SHARED_DEFS = """<svg class="dg-defs" aria-hidden="true" focusable="false"><defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="ah-mut" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="ah-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="ah-red" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="ah-grn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="ah-grn" d="M0,0 L10,5 L0,10 z"/></marker>
  <marker id="ah-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="ah-acc" d="M0,0 L10,5 L0,10 z"/></marker>
</defs></svg>"""

_DEFS_WITH_MARKER_RE = re.compile(r"\s*<defs>(?:(?!</defs>).)*?<marker\b.*?</defs>", re.S)


def _normalize_markers(text: str) -> str:
    """ビュー独自の marker ID 接頭辞を共通 ID に寄せ、ビュー内の defs を取り除く。"""
    for name in MARKER_IDS:
        text = text.replace(f"url(#d{name})", f"url(#{name})")
    return _DEFS_WITH_MARKER_RE.sub("", text)


SHELL_CSS = """
/* ===== 単一ファイル用シェル ===== */
body{padding:0}
/* 矢じり定義はパネルの外に1つだけ置く（hidden なパネル内だと参照が解決されない） */
.dg-defs{position:absolute;width:0;height:0;overflow:hidden}
.panel{padding:18px}
.panel[hidden]{display:none}
.tabbar{position:sticky;top:0;z-index:20;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
  padding:10px 18px;background:var(--card);border-bottom:1px solid var(--border)}
.tabbar .brand{font-size:12.5px;color:var(--muted);margin-right:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tabbar .tab{border:1px solid var(--border);background:var(--bg);border-radius:999px;
  padding:6px 15px;font-size:13px;cursor:pointer;color:var(--muted);font-family:inherit}
.tabbar .tab[aria-selected="true"]{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.tabbar .tab:focus-visible,.tabbar .theme:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tabbar .theme{border:1px solid var(--border);background:var(--bg);border-radius:999px;
  padding:6px 13px;font-size:12.5px;cursor:pointer;color:var(--muted);font-family:inherit}
.scorebar{top:53px !important;z-index:10 !important}

/* ===== 整合性チェック（例外ファースト: fail があるときだけ開く） ===== */
.ig{background:var(--card);border-bottom:1px solid var(--border)}
.ig>summary{cursor:pointer;list-style:none;padding:7px 18px;font-size:12px;color:var(--muted);
  display:flex;gap:11px;align-items:center;flex-wrap:wrap}
.ig>summary::-webkit-details-marker{display:none}
.ig>summary::before{content:"\\25B8";color:var(--muted)}
.ig[open]>summary::before{content:"\\25BE"}
.ig>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ig-badge{border:1px solid var(--border);border-radius:999px;padding:2px 11px;font-weight:600}
.ig-badge.ok{color:var(--grn,#1a7f4b)}
.ig-badge.warn{color:var(--amber,#a86a00)}
.ig-badge.fail{color:var(--red,#c0392b)}
.ig-diff{color:var(--muted)}
.ig-hint{color:var(--muted)}
.ig-more{color:var(--muted);font-size:11.5px;margin-left:4px}
.ig-body{padding:0 18px 12px;font-size:12.5px}
.ig-row{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border)}
.ig-row>span:nth-child(2){flex:1;min-width:0}
.ig-lv{flex:0 0 5.4em;font-weight:700;font-size:11px;letter-spacing:.05em}
.ig-lv.fail{color:var(--red,#c0392b)}
.ig-lv.warn{color:var(--amber,#a86a00)}
.ig-lv.info{color:var(--muted)}
.ig-lv.ig-cat{flex:0 0 auto;white-space:nowrap}
/* タブをまたぐジャンプボタン（再構成ビュー → 全文の該当章） */
.jump{border:1px solid var(--border);background:var(--bg);border-radius:999px;padding:1px 10px;
  font-size:11.5px;cursor:pointer;color:var(--accent);font-family:inherit;white-space:nowrap;margin:2px 4px 2px 0}
.jump:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
"""

SHELL_JS = """
(function(){
  /* テーマ: prefers-color-scheme を初期値に、hash 経由で各パネルの applyTheme とも同期させる */
  var toggle = document.getElementById('theme-toggle');
  function isDark(){ return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function paint(dark){
    if(dark){ document.documentElement.setAttribute('data-theme','dark'); }
    else { document.documentElement.removeAttribute('data-theme'); }
    toggle.textContent = dark ? '☀️ ライト' : '\U0001F319 ダーク';
    toggle.setAttribute('aria-pressed', String(dark));
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(window.location.hash.indexOf('theme=') === -1){
    window.location.hash = prefersDark ? 'theme=dark' : 'theme=light';
  }
  function sync(){ paint(window.location.hash.indexOf('theme=dark') !== -1); }
  sync();
  window.addEventListener('hashchange', sync);
  toggle.addEventListener('click', function(){
    window.location.hash = isDark() ? 'theme=light' : 'theme=dark';
  });

  /* タブ切り替え */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab'));
  function activate(panelId){
    tabs.forEach(function(o){
      var on = (o.dataset.panel === panelId);
      o.setAttribute('aria-selected', String(on));
      document.getElementById(o.dataset.panel).hidden = !on;
    });
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      activate(t.dataset.panel);
      window.scrollTo(0,0);
    });
  });

  /* タブをまたぐジャンプ。data-goto は全文ビューの章 id（見出し由来で安定）を指す */
  document.addEventListener('click', function(ev){
    var el = ev.target;
    var btn = (el && el.closest) ? el.closest('[data-goto]') : null;
    if(!btn){ return; }
    var target = document.getElementById(btn.getAttribute('data-goto'));
    if(!target){ return; }
    var panel = target.closest('.panel');
    if(panel){ activate(panel.id); }
    if(target.tagName === 'DETAILS'){ target.open = true; }
    target.scrollIntoView({block:'start'});
  });
})();
"""


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── 整合性チェックと前回比 diff ──────────────────────────────────────────────
# 再構成ビュー（01〜03）は LLM が「そのときの原本」から書く。原本が改訂されても
# ビューは黙って古いままになり、`core.yaml` の source_refs（行番号）は静かにズレる。
# そこで生成のたびに宣言（core.yaml）と実体（原本 Markdown）を突合し、
# 乖離を fail / warn / info として生成物自身とコンソールに自己申告する。
# 検査は自己申告に留め、ビルドは落とさない（レビューの commit を妨げないため）。

SNAPSHOT_NAME = ".snapshot.json"

_SEC_NUM_RE = re.compile(r"^(\d+(?:\.\d+)*)[.．]?\s")


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _sec_id(title: str) -> str:
    """見出しから安定した ID を作る。

    連番（ft-sec-1, 2, …）にすると章を1つ挿入しただけで以降の ID がすべてずれ、
    他ビューから張ったジャンプが静かに壊れる。ID は見出しの内容だけから決める。
    """
    m = _SEC_NUM_RE.match(title)
    if m:
        return "ft-s" + m.group(1).replace(".", "-")
    return "ft-h" + hashlib.sha1(title.encode("utf-8")).hexdigest()[:8]


def _assign_sec_ids(titles: list[str]) -> list[str]:
    """見出し一覧に一意な ID を割り当てる。全文ビューと整合性チェックで同じ結果を使う。"""
    out: list[str] = []
    seen: dict[str, int] = {}
    for t in titles:
        sid = _sec_id(t)
        seen[sid] = seen.get(sid, 0) + 1
        out.append(sid if seen[sid] == 1 else f"{sid}-{seen[sid]}")
    return out


def _spec_outline(md: str) -> list[tuple[str, int, int]]:
    """原本の `##` 見出しを (見出し, 開始行, 終了行) で返す。行番号は1始まりで原本と一致する。"""
    lines = md.splitlines()
    fence: str | None = None
    cuts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = _FENCE_RE.match(line)
        if m:
            if fence is None:
                fence = m.group(1)
            elif len(m.group(1)) >= len(fence) and not m.group(2).strip():
                fence = None
            continue
        if fence is None and line.startswith("## "):
            cuts.append((i, line[3:].strip()))

    out: list[tuple[str, int, int]] = []
    for k, (start, title) in enumerate(cuts):
        end = cuts[k + 1][0] if k + 1 < len(cuts) else len(lines)
        out.append((title, start + 1, end))
    return out


def _collect_refs(node: object, out: list[dict]) -> None:
    """core.yaml の任意の深さにある source_refs を集める。"""
    if isinstance(node, dict):
        refs = node.get("source_refs")
        if isinstance(refs, list):
            for r in refs:
                if isinstance(r, dict):
                    out.append(r)
        for v in node.values():
            _collect_refs(v, out)
    elif isinstance(node, list):
        for v in node:
            _collect_refs(v, out)


def _load_snapshot(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def integrity(spec_path: Path, bundle: Path) -> tuple[list[dict], dict, dict]:
    """原本と core.yaml・前回スナップショットを突合する。

    戻り値は (findings, diff, snapshot)。findings は level / message / hint / goto を持つ。
    """
    md = spec_path.read_text(encoding="utf-8")
    lines = md.splitlines()
    total = len(lines)
    outline = _spec_outline(md)
    sec_ids = _assign_sec_ids([t for t, _, _ in outline])

    sections = {
        sid: {"title": title, "hash": _hash("\n".join(lines[start - 1:end]))}
        for sid, (title, start, end) in zip(sec_ids, outline)
    }

    prev = _load_snapshot(bundle / SNAPSHOT_NAME)
    prev_secs: dict = prev.get("sections") or {}
    prev_refs: dict = prev.get("refs") or {}
    has_prev = bool(prev.get("at"))

    findings: list[dict] = []

    def add(level: str, message: str, hint: str = "", goto: str = "") -> None:
        findings.append({"level": level, "message": message, "hint": hint, "goto": goto})

    # ── 前回比 diff（章単位） ──
    diff: dict = {"prevAt": prev.get("at") if has_prev else None,
                  "added": [], "removed": [], "changed": []}
    if has_prev:
        for sid, cur in sections.items():
            old = prev_secs.get(sid)
            if old is None:
                diff["added"].append({"id": sid, "title": cur["title"]})
            elif old.get("hash") != cur["hash"]:
                diff["changed"].append({"id": sid, "title": cur["title"]})
        for sid, old in prev_secs.items():
            if sid not in sections:
                diff["removed"].append({"id": sid, "title": old.get("title", sid)})

    # ── core.yaml の source_refs（行番号）の突合 ──
    core_path = bundle / "core.yaml"
    refs: list[dict] = []
    snap_refs: dict = {}

    if not core_path.is_file():
        add("info", f"{core_path} が無いため参照突合をスキップした")
    elif yaml is None:
        add("info", "PyYAML が無いため core.yaml の参照突合をスキップした", "pip install pyyaml")
    else:
        try:
            _collect_refs(yaml.safe_load(core_path.read_text(encoding="utf-8")), refs)
        except yaml.YAMLError as exc:  # type: ignore[union-attr]
            add("fail", f"core.yaml をパースできない: {exc}")

    # 行番号が全体的にズレると参照は一斉に壊れる。1件ずつ並べると本当に見るべき
    # 「指す章が変わった」が埋もれるので、同じ診断はまとめて1行にする。
    changed_sids = {d["id"] for d in diff["changed"]}
    covered_sids: set[str] = set()
    moved: list[str] = []    # 指す章そのものが変わった（決定的なズレ）
    shifted: list[str] = []  # 章は改訂されていないのに参照先本文が変わった（行番号ズレ）
    revised: list[str] = []  # 章自体が改訂された（ビューの記述が古い可能性）

    for ref in refs:
        rid = str(ref.get("id") or "?")
        loc = ref.get("lines")
        if not isinstance(loc, dict):
            continue
        start, end = loc.get("start"), loc.get("end")
        if not isinstance(start, int) or not isinstance(end, int):
            add("warn", f"参照 {rid} の lines が数値でない")
            continue

        if start < 1 or end < start or end > total:
            add("fail",
                f"参照 {rid} の行範囲 {start}–{end} が原本の範囲外（原本は {total} 行）",
                "仕様書の改訂に core.yaml の source_refs が追従していない")
            continue

        hit = [(sid, title) for sid, (title, s, e) in zip(sec_ids, outline)
               if not (end < s or start > e)]
        for sid, _ in hit:
            covered_sids.add(sid)
        heading = hit[0][1] if hit else None
        goto = hit[0][0] if hit else ""

        cur_hash = _hash("\n".join(lines[start - 1:end]))
        old = prev_refs.get(rid)
        if old:
            if old.get("heading") != heading:
                add("fail",
                    f"参照 {rid} の指す章が変わった: 「{old.get('heading')}」→「{heading}」",
                    "core.yaml の source_refs を貼り直す", goto)
                moved.append(rid)
            elif old.get("hash") != cur_hash:
                (revised if goto in changed_sids else shifted).append(rid)
        elif len(hit) > 1:
            # 前回比が取れない初回のみ、範囲が章をまたぐこと自体を疑う
            add("warn",
                f"参照 {rid}（{start}–{end}）が {len(hit)} 章にまたがる: "
                + " / ".join(t for _, t in hit),
                "行番号がズレて隣の章まで含んでいる可能性がある", goto)
        snap_refs[rid] = {"heading": heading, "hash": cur_hash, "lines": [start, end]}

    def _ids(items: list[str]) -> str:
        return " / ".join(items[:8]) + (f" …他 {len(items) - 8} 件" if len(items) > 8 else "")

    if shifted:
        add("fail",
            f"章の内容は変わっていないのに参照先本文が変わった参照が {len(shifted)} 件: {_ids(shifted)}",
            "行番号がズレている。core.yaml の source_refs を貼り直す")
    if revised:
        add("warn",
            f"参照先の章が改訂された参照が {len(revised)} 件: {_ids(revised)}",
            "これらを根拠にした再構成ビューの記述が古い可能性がある")

    # ── どの参照にも触れられていない章 ──
    if refs:
        untouched = [(sid, sections[sid]["title"]) for sid in sec_ids if sid not in covered_sids]
        if untouched:
            add("info",
                f"core.yaml がどの source_ref でも触れていない章が {len(untouched)} 件: "
                + " / ".join(t for _, t in untouched[:6])
                + (" …" if len(untouched) > 6 else ""),
                "再構成ビューから抜けている可能性がある（全文タブには収録済み）",
                untouched[0][0])

    snapshot = {
        "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "spec": str(spec_path),
        "spec_hash": _hash(md),
        "sections": sections,
        "refs": snap_refs,
    }
    return findings, diff, snapshot


_LEVEL_LABEL = {"fail": "FAIL", "warn": "WARN", "info": "INFO"}


def _diff_chips(items: list[dict], label: str) -> str:
    if not items:
        return ""
    chips = "".join(
        f'<button type="button" class="jump" data-goto="{_escape(i["id"])}">'
        f'{_escape(i["title"])}</button>'
        for i in items[:8]
    )
    more = f'<span class="ig-more">他 {len(items) - 8} 件</span>' if len(items) > 8 else ""
    return (f'<div class="ig-row"><span class="ig-lv info ig-cat">{label} {len(items)}</span>'
            f"<span>{chips}{more}</span></div>")


def _render_integrity(findings: list[dict], diff: dict) -> str:
    """整合性チェックの結果を、タブの外に置く折りたたみパネルとして描く。

    例外ファースト: fail があるときだけ開いた状態で出し、正常なら畳んで置く。
    """
    n_fail = sum(1 for f in findings if f["level"] == "fail")
    n_warn = sum(1 for f in findings if f["level"] == "warn")
    n_info = sum(1 for f in findings if f["level"] == "info")

    if n_fail:
        badge_cls, badge = "fail", f"整合性 fail {n_fail} / warn {n_warn}"
    elif n_warn:
        badge_cls, badge = "warn", f"整合性 warn {n_warn}"
    else:
        badge_cls, badge = "ok", "整合性 OK"
    if n_info:
        badge += f" / info {n_info}"

    if diff.get("prevAt"):
        n_ch = len(diff["changed"]) + len(diff["added"]) + len(diff["removed"])
        summary_diff = (
            f'<span class="ig-diff">前回生成 {_escape(diff["prevAt"])} から '
            + (f'変更 {len(diff["changed"])} / 追加 {len(diff["added"])} / 削除 {len(diff["removed"])} 章'
               if n_ch else "章の変更なし")
            + "</span>"
        )
    else:
        summary_diff = '<span class="ig-diff">前回スナップショットなし（今回が基準）</span>'

    order = {"fail": 0, "warn": 1, "info": 2}
    rows = "".join(
        f'<div class="ig-row"><span class="ig-lv {f["level"]}">{_LEVEL_LABEL[f["level"]]}</span>'
        f'<span>{_escape(f["message"])}'
        + (f'<span class="ig-hint"> — {_escape(f["hint"])}</span>' if f["hint"] else "")
        + "</span>"
        + (f'<button type="button" class="jump" data-goto="{_escape(f["goto"])}">→ 全文</button>'
           if f["goto"] else "")
        + "</div>"
        for f in sorted(findings, key=lambda x: order[x["level"]])
    )
    if not rows:
        rows = '<div class="ig-row"><span class="ig-lv info">OK</span>' \
               '<span>core.yaml の参照と原本の間に乖離はない</span></div>'

    body = (
        _diff_chips(diff.get("changed", []), "変更された章")
        + _diff_chips(diff.get("added", []), "追加された章")
        + _diff_chips(diff.get("removed", []), "削除された章")
        + rows
    )
    return (
        f'<details class="ig" id="ig-panel"{" open" if n_fail else ""}>'
        f'<summary><span class="ig-badge {badge_cls}">{_escape(badge)}</span>{summary_diff}'
        '<span class="ig-hint">生成のたびに core.yaml の参照行と原本を突合している</span></summary>'
        f'<div class="ig-body">{body}</div></details>'
    )


def build(views: list[tuple[str, Path]], out: Path, title: str, source: str | None) -> list[dict]:
    """ビューを単一 HTML に結合する。戻り値は整合性チェックの findings（原本が無いときは空）。"""
    styles: list[str] = []
    panels: list[str] = []
    scripts: list[str] = []
    tabs: list[str] = []

    for i, (label, path) in enumerate(views):
        raw = path.read_text(encoding="utf-8")
        panel_id = f"panel-{i + 1}"

        styles.append(
            f"/* ===== {path.name} ===== */\n"
            + _normalize_markers(_grab(r"<style>(.*?)</style>", raw, "<style>", path))
        )

        body = _grab(r"<body>(.*?)</body>", raw, "<body>", path)
        js = _grab(r"<script>(.*?)</script>", raw, "<script>", path)
        body = re.sub(r"<script>.*?</script>", "", body, flags=re.S).strip()
        body = _normalize_markers(_expand_diagrams(body, path.parent))

        hidden = "" if i == 0 else " hidden"
        panels.append(f'<section class="panel" id="{panel_id}"{hidden}>\n{body}\n</section>')
        scripts.append(f"/* ===== {path.name} ===== */\n(function(){{\n{_scope(js, panel_id)}\n}})();")
        tabs.append(
            f'  <button type="button" class="tab" role="tab" data-panel="{panel_id}" '
            f'aria-selected="{"true" if i == 0 else "false"}">{_escape(label)}</button>'
        )

    brand = f'<span class="brand">{_escape(source)}</span>\n' if source else ""
    nl = "\n"

    # 整合性チェック（原本があるときだけ）。自己申告に留め、ビルドは落とさない
    ig_html = ""
    findings: list[dict] = []
    if source and Path(source).is_file():
        bundle = out.parent / out.stem
        findings, diff, snapshot = integrity(Path(source), bundle)
        ig_html = "\n" + _render_integrity(findings, diff) + "\n"
        # refresh が同じ引数で build を再実行できるよう、呼び出しをそのまま記録する。
        # これが無いと refresh はビューのラベルを命名規約から推測するしかない。
        snapshot["manifest"] = {
            "title": title,
            "out": str(out),
            "views": [[label, str(path)] for label, path in views],
        }
        bundle.mkdir(parents=True, exist_ok=True)
        (bundle / SNAPSHOT_NAME).write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
        )
        for f in findings:
            print(f"  [{f['level']}] {f['message']}" + (f" — {f['hint']}" if f["hint"] else ""))
        n_changed = len(diff["changed"]) + len(diff["added"]) + len(diff["removed"])
        if diff.get("prevAt"):
            print(f"  前回生成 {diff['prevAt']} から章の増減・変更: {n_changed} 件")

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_escape(title)}</title>
<style>
{nl.join(styles)}
{SHELL_CSS}
</style>
</head>
<body>

{SHARED_DEFS}

<nav class="tabbar" role="tablist" aria-label="ビュー切り替え">
  {brand}{nl.join(tabs)}
  <button type="button" class="theme" id="theme-toggle" aria-pressed="false">\U0001F319 ダーク</button>
</nav>
{ig_html}
{nl.join(panels)}

<script>
{SHELL_JS}
{nl.join(scripts)}
</script>
</body>
</html>
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    size_kb = len(html.encode("utf-8")) / 1024
    print(f"spec-html.py: wrote {out} ({size_kb:.0f} KB, {len(views)} view(s))")
    return findings


# ── 全文ビュー: Markdown → HTML の決定論的変換 ──────────────────────────────
# 原本と乖離してはいけないビューなので LLM を介さず機械変換する。
# 対応するのは docs/plans の仕様書が実際に使う記法だけ（見出し / フェンス（``` と ````）/
# 表 / 引用 / 箇条書き / 番号リスト / 水平線 / 強調 / インラインコード / リンク）。

_FENCE_RE = re.compile(r"^(`{3,})(.*)$")
_HEAD_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_UL_RE = re.compile(r"^(\s*)[-*]\s+(.*)$")
_OL_RE = re.compile(r"^(\s*)(\d+)\.\s+(.*)$")
_TABLE_SEP_RE = re.compile(r"^\s*\|[\s:|-]+\|?\s*$")


def _strip_scheme(url: str) -> str:
    """オフライン自己完結を保つため、URL はスキームを落として平文にする（リンクにしない）。"""
    return re.sub(r"^https?://", "", url)


def _strip_scheme_all(text: str) -> str:
    """テキスト中のすべての URL からスキームを落とす。"""
    return re.sub(r"https?://", "", text)


def _md_inline(text: str) -> str:
    """インライン記法を HTML 化する。コードスパンの中身は加工しない。"""
    text = _escape(text)

    spans: list[str] = []

    def stash(m: re.Match[str]) -> str:
        # コードスパンは他のインライン変換から保護するが、
        # スキーム除去だけはオフライン自己完結のため必ず適用する
        spans.append(f"<code>{_strip_scheme_all(m.group(1))}</code>")
        return f"\x00{len(spans) - 1}\x00"

    text = re.sub(r"`([^`\n]+)`", stash, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    # [表示テキスト](リンク先) — リンクにはせず、URL はスキームを落として併記する
    text = re.sub(
        r"\[([^\]]*)\]\(([^)]*)\)",
        lambda m: m.group(1) + (f"（{_strip_scheme(m.group(2))}）" if m.group(2) else ""),
        text,
    )
    text = re.sub(r"https?://[^\s<>()｜|]+", lambda m: _strip_scheme(m.group(0)), text)

    return re.sub(r"\x00(\d+)\x00", lambda m: spans[int(m.group(1))], text)


def _render_table(rows: list[str]) -> str:
    def cells(row: str) -> list[str]:
        parts = row.strip().split("|")
        if parts and not parts[0].strip():
            parts = parts[1:]
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        return [c.strip() for c in parts]

    head, body = rows[0], rows[1:]
    if body and _TABLE_SEP_RE.match(body[0]):
        body = body[1:]

    out = ['<div class="md-tablewrap"><table>', "<thead><tr>"]
    out += [f"<th>{_md_inline(c)}</th>" for c in cells(head)]
    out.append("</tr></thead><tbody>")
    for row in body:
        out.append("<tr>" + "".join(f"<td>{_md_inline(c)}</td>" for c in cells(row)) + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def _render_list(items: list[tuple[int, str, bool]]) -> str:
    """(インデント階層, 中身, 番号付きか) の並びを入れ子リストに組む。"""
    out: list[str] = []
    stack: list[str] = []
    for level, content, ordered in items:
        tag = "ol" if ordered else "ul"
        while len(stack) > level + 1:
            out.append(f"</{stack.pop()}>")
        if len(stack) == level + 1 and stack[-1] != tag:
            out.append(f"</{stack.pop()}>")
        while len(stack) < level + 1:
            stack.append(tag)
            out.append(f"<{tag}>")
        out.append(f"<li>{_md_inline(content)}</li>")
    while stack:
        out.append(f"</{stack.pop()}>")
    return "".join(out)


def _render_blocks(lines: list[str]) -> str:
    out: list[str] = []
    buf_table: list[str] = []
    buf_list: list[tuple[int, str, bool]] = []
    buf_quote: list[str] = []
    buf_para: list[str] = []

    def flush() -> None:
        nonlocal buf_table, buf_list, buf_quote, buf_para
        if buf_table:
            out.append(_render_table(buf_table))
            buf_table = []
        if buf_list:
            out.append(_render_list(buf_list))
            buf_list = []
        if buf_quote:
            out.append(f'<blockquote>{_render_blocks(buf_quote)}</blockquote>')
            buf_quote = []
        if buf_para:
            out.append(f'<p>{"<br>".join(_md_inline(x) for x in buf_para)}</p>')
            buf_para = []

    i = 0
    while i < len(lines):
        line = lines[i]

        fence = _FENCE_RE.match(line)
        if fence:
            flush()
            marker, lang = fence.group(1), fence.group(2).strip()
            body: list[str] = []
            i += 1
            while i < len(lines):
                close = _FENCE_RE.match(lines[i])
                if close and len(close.group(1)) >= len(marker) and not close.group(2).strip():
                    break
                body.append(lines[i])
                i += 1
            label = f'<span class="md-lang">{_escape(lang)}</span>' if lang else ""
            # コードブロック内の URL もスキームを落とす（オフライン自己完結を保つため）
            code = _escape(_strip_scheme_all(chr(10).join(body)))
            out.append(f'<div class="md-pre">{label}<pre><code>{code}</code></pre></div>')
            i += 1
            continue

        head = _HEAD_RE.match(line)
        if head:
            flush()
            level = min(len(head.group(1)) + 1, 6)
            out.append(f'<h{level} class="md-h">{_md_inline(head.group(2))}</h{level}>')
            i += 1
            continue

        if line.startswith(">"):
            if buf_table or buf_list or buf_para:
                flush()
            buf_quote.append(re.sub(r"^>\s?", "", line))
            i += 1
            continue

        if line.strip().startswith("|"):
            if buf_list or buf_quote or buf_para:
                flush()
            buf_table.append(line)
            i += 1
            continue

        ul, ol = _UL_RE.match(line), _OL_RE.match(line)
        if ul or ol:
            if buf_table or buf_quote or buf_para:
                flush()
            indent = len((ul or ol).group(1))
            buf_list.append((min(indent // 2, 4), (ul.group(2) if ul else ol.group(3)), ol is not None))
            i += 1
            continue

        if re.match(r"^-{3,}$|^\*{3,}$", line.strip()):
            flush()
            out.append("<hr>")
            i += 1
            continue

        if not line.strip():
            flush()
            i += 1
            continue

        if buf_table or buf_list or buf_quote:
            flush()
        buf_para.append(line)
        i += 1

    flush()
    return "".join(out)


def _split_sections(md: str) -> tuple[str, list[tuple[str, str]]]:
    """フェンスの外にある `## ` 見出しで分割する。戻り値は (前書き, [(見出し, 本文)])。"""
    lines = md.splitlines()
    fence_marker: str | None = None
    cuts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = _FENCE_RE.match(line)
        if m:
            if fence_marker is None:
                fence_marker = m.group(1)
            elif len(m.group(1)) >= len(fence_marker) and not m.group(2).strip():
                fence_marker = None
            continue
        if fence_marker is None and line.startswith("## "):
            cuts.append((i, line[3:].strip()))

    if not cuts:
        return md, []
    preamble = "\n".join(lines[: cuts[0][0]])
    sections = []
    for k, (start, title) in enumerate(cuts):
        end = cuts[k + 1][0] if k + 1 < len(cuts) else len(lines)
        sections.append((title, "\n".join(lines[start + 1 : end])))
    return preamble, sections


FULLTEXT_TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ — 全文</title>
<style>
:root{
  --bg:#f7f8fa; --card:#fff; --border:#e3e6ec; --text:#1d2330; --muted:#5b6577;
  --accent:#2b6cff; --chip:#eef1f6; --code:#f2f4f8;
}
:root[data-theme="dark"]{
  --bg:#0f1115; --card:#171a21; --border:#2c313c; --text:#e6e9ef; --muted:#9aa3b2;
  --accent:#5aa9ff; --chip:#262b36; --code:#12151c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI","Noto Sans JP",Meiryo,sans-serif;
  line-height:1.7;padding:18px;font-size:14px}
.ft-head h1{font-size:19px;margin:0 0 4px}
.ft-lead{color:var(--muted);margin:0 0 6px;font-size:13.5px}
.ft-note{background:var(--chip);border:1px solid var(--border);border-radius:9px;
  padding:9px 12px;font-size:12.5px;color:var(--muted);margin:10px 0}
.ft-ctl{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.ft-ctl button{border:1px solid var(--border);background:var(--card);border-radius:999px;
  padding:5px 13px;font-size:12.5px;cursor:pointer;color:var(--muted);font-family:inherit}
.ft-ctl button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ft-toc{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin:10px 0}
.ft-toc h2{font-size:13px;margin:0 0 8px;color:var(--muted);letter-spacing:.05em}
/* 見出し自体が「1.」「2.」を持つため、目次側でカウンタを重ねない */
.ft-toc ul{margin:0;padding:0;list-style:none;columns:2;column-gap:26px}
.ft-toc li{margin:3px 0;break-inside:avoid}
.ft-toc button{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;
  font-size:13px;text-align:left;font-family:inherit}
.ft-toc button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ft-sec{background:var(--card);border:1px solid var(--border);border-radius:12px;margin:10px 0;overflow:hidden}
.ft-sec>summary{cursor:pointer;padding:11px 14px;font-weight:600;font-size:14.5px;list-style:none}
.ft-sec>summary::-webkit-details-marker{display:none}
.ft-sec>summary::before{content:"▸ ";color:var(--muted)}
.ft-sec[open]>summary::before{content:"▾ "}
.ft-sec>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ft-body{padding:0 14px 14px;border-top:1px solid var(--border)}
.ft-body .md-h{margin:18px 0 7px;font-size:14px}
.ft-body h3.md-h{font-size:14.5px}
.ft-body p{margin:8px 0}
.ft-body ul,.ft-body ol{margin:7px 0;padding-left:22px}
.ft-body li{margin:4px 0}
.ft-body blockquote{margin:10px 0;padding:2px 12px;border-left:3px solid var(--accent);
  background:var(--chip);border-radius:0 8px 8px 0}
.ft-body hr{border:0;border-top:1px solid var(--border);margin:14px 0}
.ft-body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;
  background:var(--chip);border-radius:4px;padding:0 4px}
.md-pre{position:relative;margin:10px 0}
.md-pre pre{background:var(--code);border:1px solid var(--border);border-radius:9px;
  padding:11px 13px;overflow-x:auto;margin:0}
.md-pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
.md-lang{position:absolute;top:-9px;right:10px;background:var(--chip);border:1px solid var(--border);
  border-radius:5px;padding:0 7px;font-size:11px;color:var(--muted);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.md-tablewrap{overflow-x:auto;margin:10px 0}
.ft-body table{border-collapse:collapse;font-size:12.5px;min-width:100%}
.ft-body th,.ft-body td{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top}
.ft-body th{background:var(--chip);color:var(--muted);font-weight:600;white-space:nowrap}
@media (max-width:640px){body{padding:12px}.ft-toc ol{columns:1}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>

<header class="ft-head">
  <h1>__TITLE__ — 全文</h1>
  <p class="ft-lead">原本 <code>__SOURCE__</code>（__LINES__ 行）をそのまま収録した参照用タブ。DDL・プロンプト本文・表・コード例をすべて含む。</p>
  <div class="ft-note">
    正本は <code>__SOURCE__</code>。この全文は原本から機械変換した表示用であり、編集しても原本には反映されない。
    オフライン自己完結の制約により、原本に含まれる URL は <b>スキームを除いた平文</b>で表示しリンクにしていない。
  </div>
</header>

<div class="ft-ctl">
  <button type="button" id="ft-open">すべて開く</button>
  <button type="button" id="ft-close">すべて閉じる</button>
</div>

<nav class="ft-toc" aria-label="目次">
  <h2>目次</h2>
  <ul>
__TOC__
  </ul>
</nav>

__PREAMBLE__
__SECTIONS__

<script>
(function(){
  function applyTheme(){
    var dark = window.location.hash.indexOf('theme=dark') !== -1;
    if(dark){ document.documentElement.setAttribute('data-theme','dark'); }
    else { document.documentElement.removeAttribute('data-theme'); }
  }
  applyTheme();
  window.addEventListener('hashchange', applyTheme);

  var secs = Array.prototype.slice.call(document.querySelectorAll('.ft-sec'));
  document.getElementById('ft-open').addEventListener('click', function(){
    secs.forEach(function(s){ s.open = true; });
  });
  document.getElementById('ft-close').addEventListener('click', function(){
    secs.forEach(function(s){ s.open = false; });
  });

  /* 目次はアンカーではなくスクロールで移動する（location.hash はテーマ状態に使うため触らない） */
  Array.prototype.forEach.call(document.querySelectorAll('.ft-toc button'), function(b){
    b.addEventListener('click', function(){
      var target = document.getElementById(b.dataset.target);
      if(!target){ return; }
      target.open = true;
      target.scrollIntoView({block:'start'});
    });
  });
})();
</script>
</body>
</html>
"""


def fulltext(spec_path: Path, out_path: Path) -> None:
    md = spec_path.read_text(encoding="utf-8")
    lines_count = len(md.splitlines())

    title = "仕様書"
    m = re.search(r"^#\s+(.*)$", md, re.M)
    if m:
        title = m.group(1).strip()
        md = md[: m.start()] + md[m.end():]

    preamble_md, sections = _split_sections(md)

    # ID は見出しの内容から決める（連番だと章の挿入で他ビューからのジャンプが壊れる）
    sec_ids = _assign_sec_ids([h for h, _ in sections])

    toc, blocks = [], []
    for sec_id, (heading, body) in zip(sec_ids, sections):
        toc.append(f'    <li><button type="button" data-target="{sec_id}">{_md_inline(heading)}</button></li>')
        blocks.append(
            f'<details class="ft-sec" id="{sec_id}">'
            f'<summary>{_md_inline(heading)}</summary>'
            f'<div class="ft-body">{_render_blocks(body.splitlines())}</div>'
            f"</details>"
        )

    preamble_html = _render_blocks(preamble_md.splitlines()).strip()
    if preamble_html:
        preamble_html = (
            '<details class="ft-sec" id="ft-sec-0" open><summary>改訂履歴・前書き</summary>'
            f'<div class="ft-body">{preamble_html}</div></details>'
        )

    html = (
        FULLTEXT_TEMPLATE.replace("__TITLE__", _escape(title))
        .replace("__SOURCE__", _escape(str(spec_path)))
        .replace("__LINES__", f"{lines_count:,}")
        .replace("__TOC__", "\n".join(toc))
        .replace("__PREAMBLE__", preamble_html)
        .replace("__SECTIONS__", "\n".join(blocks))
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"spec-html.py: wrote {out_path} ({len(html.encode('utf-8')) / 1024:.0f} KB, {len(sections)} section(s))")


# ── 図版ジェネレータ ────────────────────────────────────────────────────────
# 手書き SVG は座標を人（LLM）が決めるため、線がボックスを貫通する・矢印が交差する・
# 日本語テキストがはみ出す、といった事故が繰り返し起きる。
# ここでは「何を図にするか」だけを JSON で宣言させ、幅の見積もりとレイアウトは
# スクリプトが決める。レイアウトが固定なので、交差と貫通は構造的に発生しない。

_CJK_RE = re.compile(r"[^\x00-\x7F]")


def _text_width(text: str, font_size: float) -> float:
    """描画幅の見積もり。CJK は約 1.0em、ASCII は約 0.55em として数える。"""
    cjk = len(_CJK_RE.findall(text))
    return round(font_size * (cjk * 1.0 + (len(text) - cjk) * 0.55), 1)


def _wrap(text: str, max_w: float, font_size: float) -> list[str]:
    """max_w に収まるよう折り返す。空白があれば優先し、無ければ文字単位で切る。"""
    if _text_width(text, font_size) <= max_w:
        return [text]

    rough: list[str] = []
    cur = ""
    for word in text.split(" "):
        cand = f"{cur} {word}".strip()
        if not cur or _text_width(cand, font_size) <= max_w:
            cur = cand
        else:
            rough.append(cur)
            cur = word
    if cur:
        rough.append(cur)

    out: list[str] = []
    for line in rough:
        while _text_width(line, font_size) > max_w and len(line) > 1:
            cut = len(line)
            while cut > 1 and _text_width(line[:cut], font_size) > max_w:
                cut -= 1
            out.append(line[:cut])
            line = line[cut:]
        out.append(line)
    return out


def _tspans(lines: list[str], x: float, y: float, cls: str, line_h: float,
            anchor: str = "start", style: str = "") -> str:
    st = f' style="{style}"' if style else ""
    a = f' text-anchor="{anchor}"' if anchor != "start" else ""
    return "".join(
        f'<text class="{cls}" x="{x}" y="{y + i * line_h}"{a}{st}>{_escape(t)}</text>'
        for i, t in enumerate(lines)
    )


_BOX_CLASS = {"plain": "", "key": " key", "warn": " warn", "ok": " ok",
              "ng": " ng", "okbg": " okbg", "later": " later", "done": " done"}
_ACCENT = {"plain": "var(--muted)", "key": "var(--accent)", "warn": "var(--amber)",
           "ok": "var(--green)", "ng": "var(--red)", "okbg": "var(--green)",
           "later": "var(--grey)", "done": "var(--green)"}
_EDGE_CLASS = {"plain": "e", "key": "e acc", "ok": "e grn", "okbg": "e grn",
               "ng": "e red", "warn": "e", "done": "e grn", "later": "e"}


def _svg(width: int, height: int, dg_id: str, title: str, desc: str, body: str) -> str:
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" '
        f'aria-labelledby="{dg_id}-t {dg_id}-d">'
        f'<title id="{dg_id}-t">{_escape(title)}</title>'
        f'<desc id="{dg_id}-d">{_escape(desc)}</desc>{body}</svg>'
    )


W = 880  # すべての図で共通の描画幅


def render_flow(d: dict, dg_id: str) -> str:
    """縦フロー ＋ 右レーンへの分岐。分岐は専用レーンに置くので本線と交差しない。"""
    # 本線と分岐レーンの間は、分岐ラベルが両側のボックスに被らない幅を確保する
    main_x, main_w = 250, 300
    br_x, br_w = 620, 240
    pad, fs_t, fs_s, lh = 14, 11.5, 11.5, 16

    steps, y, geo = d["steps"], 14, []
    parts: list[str] = []
    for st in steps:
        title = _wrap(st["text"], main_w - pad * 2, fs_t)
        sub = _wrap(st.get("sub", ""), main_w - pad * 2, fs_s) if st.get("sub") else []
        h = 16 + len(title) * lh + (len(sub) * lh if sub else 0)
        style = st.get("style", "plain")
        cx = main_x + main_w / 2
        parts.append(f'<rect class="n-box{_BOX_CLASS[style]}" x="{main_x}" y="{y}" '
                     f'width="{main_w}" height="{h}" rx="10"/>')
        parts.append(_tspans(title, cx, y + 8 + lh, "n-m", lh, "middle"))
        if sub:
            parts.append(_tspans(sub, cx, y + 8 + lh * (len(title) + 1), "n-s", lh, "middle"))
        geo.append((y, h))
        y += h + 22

    for i, (top, h) in enumerate(geo[:-1]):
        nxt = geo[i + 1][0]
        parts.append(f'<path class="e" d="M{main_x + main_w / 2},{top + h} '
                     f'L{main_x + main_w / 2},{nxt - 4}"/>')
        lbl = steps[i].get("next_label")
        if lbl:
            parts.append(f'<text class="e-t grn" x="{main_x + main_w / 2 + 8}" '
                         f'y="{top + h + 14}">{_escape(lbl)}</text>')

    for br in d.get("branches", []):
        top, h = geo[br["from"]]
        style = br.get("style", "plain")
        lines: list[str] = []
        for ln in br["lines"]:
            lines += _wrap(ln, br_w - pad * 2, fs_s)
        bh = 14 + len(lines) * lh
        by = top + h / 2 - bh / 2
        parts.append(f'<path class="{_EDGE_CLASS[style]}" d="M{main_x + main_w},{top + h / 2} '
                     f'L{br_x - 4},{top + h / 2}"/>')
        if br.get("label"):
            parts.append(f'<text class="e-t" x="{(main_x + main_w + br_x) / 2}" '
                         f'y="{top + h / 2 - 7}" text-anchor="middle" '
                         f'style="fill:{_ACCENT[style]};font-weight:600">{_escape(br["label"])}</text>')
        parts.append(f'<rect class="n-box{_BOX_CLASS[style]}" x="{br_x}" y="{by}" '
                     f'width="{br_w}" height="{bh}" rx="9"/>')
        head = f'font-weight:700;fill:{_ACCENT[style]}' if style != "plain" else "font-weight:700"
        parts.append(f'<text class="n-s" x="{br_x + pad}" y="{by + 8 + lh}" style="{head}">'
                     f'{_escape(lines[0])}</text>')
        if len(lines) > 1:
            rest = "" if style == "plain" else f"fill:{_ACCENT[style]}"
            parts.append(_tspans(lines[1:], br_x + pad, by + 8 + lh * 2, "n-s", lh, style=rest))

    if d.get("result"):
        rl: list[str] = []
        for ln in d["result"]["lines"]:
            rl += _wrap(ln, 200 - pad * 2, fs_s)
        top, h = geo[-1]
        rh = 14 + len(rl) * lh
        ry = top + h / 2 - rh / 2
        parts.append(f'<rect class="n-box key" x="20" y="{ry}" width="200" height="{rh}" rx="9"/>')
        parts.append(f'<text class="n-s" x="34" y="{ry + 8 + lh}" style="font-weight:700">'
                     f'{_escape(rl[0])}</text>')
        parts.append(_tspans(rl[1:], 34, ry + 8 + lh * 2, "n-m mut", lh))
        parts.append(f'<path class="e" d="M{main_x - 4},{top + h / 2} L224,{top + h / 2}"/>')

    return _svg(W, int(y + 4), dg_id, d["title"], d["desc"], "".join(parts))


def render_compare(d: dict, dg_id: str) -> str:
    """✕不採用 / ✓採用 の2列比較。左右は独立したパネルなので線が跨らない。"""
    pad, fs, lh, gap = 14, 11.5, 17, 20
    pw = (W - 40 - gap) / 2
    xs = (20, 20 + pw + gap)

    def panel(side: dict, x: float) -> tuple[list[str], float]:
        out, y = [], 44
        for blk in side.get("blocks", []):
            lines: list[str] = []
            for ln in [blk["text"]] + ([blk["sub"]] if blk.get("sub") else []):
                lines += _wrap(ln, pw - pad * 4, fs)
            h = 14 + len(lines) * lh
            out.append(f'<rect class="n-box{_BOX_CLASS[blk.get("style", "plain")]}" '
                       f'x="{x + pad}" y="{y}" width="{pw - pad * 2}" height="{h}" rx="8"/>')
            out.append(_tspans(lines, x + pw / 2, y + 8 + lh, "n-s", lh, "middle"))
            y += h + 10
        if side.get("notes"):
            y += 4
            style = _ACCENT[side.get("style", "plain")]
            for i, note in enumerate(side["notes"]):
                for ln in _wrap(note, pw - pad * 2, fs):
                    weight = ";font-weight:700" if i == 0 else ""
                    out.append(f'<text class="n-s" x="{x + pad}" y="{y + lh}" '
                               f'style="fill:{style}{weight}">{_escape(ln)}</text>')
                    y += lh
        return out, y + 12

    bodies, heights = [], []
    for side, x in zip((d["left"], d["right"]), xs):
        b, h = panel(side, x)
        bodies.append(b)
        heights.append(h)
    ph = max(heights)

    parts = []
    for side, x, body in zip((d["left"], d["right"]), xs, bodies):
        cls = "hd-ng" if side.get("style") == "ng" else "hd-ok"
        parts.append(f'<text class="{cls}" x="{x}" y="22">{_escape(side["head"])}</text>')
        parts.append(f'<rect class="n-box{_BOX_CLASS[side.get("style", "plain")]}" '
                     f'x="{x}" y="32" width="{pw}" height="{ph - 32}" rx="10"/>')
        parts += body
    return _svg(W, int(ph + 6), dg_id, d["title"], d["desc"], "".join(parts))


def render_causemap(d: dict, dg_id: str) -> str:
    """「決定 → 波及した結果」の因果マップ。1行1関係で、行同士は交差しない。"""
    lw, rw, pad, fs, lh = 300, 340, 14, 11.5, 16
    lx, rx = 20, W - 20 - rw
    parts, y = [], 26
    parts.append(f'<text class="n-s" x="{lx}" y="18" style="font-weight:700">'
                 f'{_escape(d.get("left_head", "決定"))}</text>')
    parts.append(f'<text class="n-s" x="{rx}" y="18" style="font-weight:700">'
                 f'{_escape(d.get("right_head", "波及した結果"))}</text>')

    for row in d["rows"]:
        lt = _wrap(row["from"], lw - pad * 2, fs)
        rt = _wrap(row["to"], rw - pad * 2, fs)
        h = 14 + max(len(lt), len(rt)) * lh
        style = row.get("style", "plain")
        parts.append(f'<rect class="n-box" x="{lx}" y="{y}" width="{lw}" height="{h}" rx="9"/>')
        parts.append(_tspans(lt, lx + pad, y + 8 + lh, "n-s", lh))
        parts.append(f'<rect class="n-box{_BOX_CLASS[style]}" x="{rx}" y="{y}" '
                     f'width="{rw}" height="{h}" rx="9"/>')
        rest = "" if style == "plain" else f"fill:{_ACCENT[style]}"
        parts.append(_tspans(rt, rx + pad, y + 8 + lh, "n-s", lh, style=rest))
        mid = y + h / 2
        parts.append(f'<path class="{_EDGE_CLASS[style]}" d="M{lx + lw},{mid} L{rx - 4},{mid}"/>')
        parts.append(f'<text class="e-t" x="{(lx + lw + rx) / 2}" y="{mid - 7}" '
                     f'text-anchor="middle" style="fill:{_ACCENT[style]};font-weight:600">'
                     f'{_escape(row.get("rel", ""))}</text>')
        y += h + 12

    if d.get("note"):
        y += 8
        parts.append(f'<text class="n-s" x="{lx}" y="{y}" style="fill:var(--red)">'
                     f'{_escape(d["note"])}</text>')
        y += 8
    return _svg(W, int(y + 4), dg_id, d["title"], d["desc"], "".join(parts))


def render_er(d: dict, dg_id: str) -> str:
    """ER ＋ 削除順序。全テーブルを1段に並べ、参照先を上に置くので線が交差しない。"""
    pad, fs, lh = 14, 11.5, 16
    tables = d["tables"]
    cols = len(tables)
    gap = 18
    tw = (W - 40 - gap * (cols - 1)) / cols
    ty = 150

    parts = []
    root = d["root"]
    rw2 = max(200.0, _text_width(root["name"], 13) + 40)
    rx2 = W / 2 - rw2 / 2
    parts.append(f'<rect class="n-box key" x="{rx2}" y="14" width="{rw2}" height="46" rx="10"/>')
    parts.append(f'<text class="n-t" x="{W / 2}" y="36" text-anchor="middle">{_escape(root["name"])}</text>')
    parts.append(f'<text class="n-s" x="{W / 2}" y="52" text-anchor="middle">{_escape(root.get("sub", ""))}</text>')

    centers = {}
    max_h = 0
    for i, t in enumerate(tables):
        x = 20 + i * (tw + gap)
        # 丸数字バッジは右上（半径13）に描くので、テーブル名の折り返し幅から避ける。
        # 引かないとテーブル数が増えて幅が狭まったときに名前がバッジの下に潜る。
        badge_w = 36 if t.get("order") else 0
        name = _wrap(t["name"], tw - pad * 2 - badge_w, fs)
        body: list[str] = []
        for ln in t.get("lines", []):
            body += _wrap(ln, tw - pad * 2, fs)
        h = 16 + (len(name) + len(body)) * lh
        max_h = max(max_h, h)
        parts.append(f'<rect class="n-box{_BOX_CLASS[t.get("style", "plain")]}" x="{x}" y="{ty}" '
                     f'width="{tw}" height="{h}" rx="10"/>')
        parts.append(_tspans(name, x + pad, ty + 8 + lh, "n-m", lh))
        parts.append(_tspans(body, x + pad, ty + 8 + lh * (len(name) + 1), "n-s", lh))
        if t.get("order"):
            parts.append(f'<circle class="ord-bg" cx="{x + tw - 20}" cy="{ty + 18}" r="13"/>')
            parts.append(f'<text class="ord" x="{x + tw - 20}" y="{ty + 23}" text-anchor="middle">'
                         f'{_escape(str(t["order"]))}</text>')
        cx = x + tw / 2
        centers[t["name"]] = (cx, ty, h)
        parts.append(f'<path class="e" d="M{cx},{ty - 4} C{cx},{ty - 60} {W / 2},{100} {W / 2},{64}"/>')
        parts.append(f'<text class="e-t" x="{cx}" y="{ty - 18}" text-anchor="middle">'
                     f'{_escape(d.get("fk_label", "FK"))}</text>')

    y = ty + max_h + 26
    for e in d.get("extra_edges", []):
        fx, fty, fh = centers[e["from"]]
        tx, tty, th = centers[e["to"]]
        parts.append(f'<path class="{_EDGE_CLASS[e.get("style", "ok")]}" '
                     f'd="M{fx},{fty + fh + 20} L{tx},{fty + fh + 4}"/>')
        parts.append(f'<text class="e-t grn" x="{fx + 10}" y="{fty + fh + 18}">{_escape(e["label"])}</text>')
        y = max(y, fty + fh + 34)

    if d.get("callout"):
        lines: list[str] = []
        for ln in d["callout"]["lines"]:
            lines += _wrap(ln, W - 40 - pad * 2, fs)
        ch = 14 + len(lines) * lh
        parts.append(f'<rect class="n-box ng" x="20" y="{y}" width="{W - 40}" height="{ch}" rx="10"/>')
        for i, ln in enumerate(lines):
            weight = ";font-weight:700" if i == 0 else ""
            parts.append(f'<text class="n-s" x="34" y="{y + 8 + lh * (i + 1)}" '
                         f'style="fill:var(--red){weight}">{_escape(ln)}</text>')
        y += ch
    return _svg(W, int(y + 8), dg_id, d["title"], d["desc"], "".join(parts))


RENDERERS = {"flow": render_flow, "compare": render_compare,
             "causemap": render_causemap, "er": render_er}

_PLACEHOLDER_RE = re.compile(
    r'<div class="dg"\s+data-dg-type="(?P<type>\w+)"\s+data-dg-src="(?P<src>[^"]+)"\s*>\s*</div>'
)


def _expand_diagrams(body: str, base: Path) -> str:
    """ビュー内のプレースホルダを、JSON から生成した SVG に置き換える。"""
    def sub(m: re.Match[str]) -> str:
        kind, src = m.group("type"), m.group("src")
        if kind not in RENDERERS:
            sys.exit(f"未知の図版タイプ: {kind}（{base}）")
        path = base / src
        if not path.is_file():
            sys.exit(f"図版データが見つからない: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        dg_id = re.sub(r"[^\w-]", "-", src.rsplit("/", 1)[-1].removesuffix(".json"))
        svg = RENDERERS[kind](data, dg_id)
        cap = f'<p class="dg-cap">{data["caption"]}</p>' if data.get("caption") else ""
        return f'<div class="dg">{svg}</div>{cap}'

    return _PLACEHOLDER_RE.sub(sub, body)


# ── refresh: 仕様書の改訂に、機械生成できる部分だけ即座に追従させる ──────────
# 01〜03 の再構成ビューは core.yaml を LLM が解釈して書くので機械では直せない。
# ここで触るのは全文ビューと結合 HTML だけにして、意味側の陳腐化は「黙って直す」
# のではなく整合性チェックの結果として声に出す。

ROOT = Path(__file__).resolve().parent.parent
PLANS_DIR = ROOT / "docs" / "plans"
HTML_DIR = PLANS_DIR / "_html"

# SKILL.md が定めるビューの命名規約。manifest を持たない古いバンドル用のフォールバック。
_FALLBACK_LABELS = {
    "status": "ステータスと次の一手",
    "decisions": "設計判断",
    "quiz": "クイズ",
    "fulltext": "全文",
}


def _abs(raw: str) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else ROOT / p


def _spec_h1(spec: Path) -> str:
    for line in spec.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _bundle_plan(spec: Path) -> dict | None:
    """バンドルがある仕様書について、build を再実行するための引数一式を復元する。"""
    bundle = HTML_DIR / spec.stem
    if not bundle.is_dir():
        return None

    snap = _load_snapshot(bundle / SNAPSHOT_NAME)
    manifest = snap.get("manifest") or {}
    views = [(label, _abs(path)) for label, path in manifest.get("views") or []]
    if not views:
        for path in sorted((bundle / "views").glob("*.html")):
            key = path.stem.split("-", 1)[-1]
            views.append((_FALLBACK_LABELS.get(key, key), path))
    views = [(label, path) for label, path in views if path.is_file()]
    if not views:
        return None

    return {
        "views": views,
        "out": _abs(manifest["out"]) if manifest.get("out") else HTML_DIR / f"{spec.stem}.html",
        # manifest が無い旧バンドルでは原本の H1 から起こす（slug より人間が読める）
        "title": manifest.get("title") or f"{_spec_h1(spec) or spec.stem} — 図解",
        "spec_hash": snap.get("spec_hash"),
    }


def refresh(specs: list[Path], check_only: bool) -> int:
    """仕様書の改訂を検出し、全文ビューと結合 HTML を再生成する。

    バンドルが無い仕様書は対象外（無言でスキップ）。更新不要なら何も出力しない。
    """
    # フックや husky から任意の cwd で呼ばれる。build に渡す原本パスは
    # HTML のタブバーに出るので相対のまま保ちたく、cwd 側をリポジトリ root に寄せる。
    os.chdir(ROOT)
    stale = 0
    failed = 0

    for spec in specs:
        plan = _bundle_plan(spec)
        if plan is None:
            continue
        if _hash(spec.read_text(encoding="utf-8")) == plan["spec_hash"] and plan["out"].is_file():
            continue

        stale += 1
        rel = spec.relative_to(ROOT) if spec.is_relative_to(ROOT) else spec
        if check_only:
            print(f"spec-html.py: 図解が古い: {plan['out'].name}（{rel} が改訂されている）")
            continue

        print(f"spec-html.py: {rel} の改訂を検出。図解を再生成する")
        for _, path in plan["views"]:
            if "fulltext" in path.stem:
                fulltext(spec, path)
        findings = build(plan["views"], plan["out"], plan["title"], str(rel))

        if check(plan["out"]):
            print(f"spec-html.py: 安全検査に失敗した: {plan['out']}")
            failed += 1
            continue

        # 参照のズレ ＝ core.yaml が仕様書に追いついていない ＝ 01〜03 の記述も古い可能性。
        drift = [f for f in findings if f["level"] in ("fail", "warn")]
        if drift:
            print(f"spec-html.py: 再構成ビュー（01〜03）が陳腐化している可能性がある。"
                  f"整合性チェックが {len(drift)} 件の fail/warn を出した（上記）。"
                  f"`.agents/skills/spec-to-html/SKILL.md` に従って core.yaml の source_refs を貼り直すこと")

    if failed:
        return 1
    return 1 if (check_only and stale) else 0


def _parse_view(spec: str) -> tuple[str, Path]:
    if "=" not in spec:
        sys.exit(f'--view は "ラベル=パス" 形式で指定する: {spec}')
    label, _, raw_path = spec.partition("=")
    path = Path(raw_path)
    if not path.is_file():
        sys.exit(f"ビューが見つからない: {path}")
    return label.strip(), path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build", help="ビュー HTML を単一 HTML に結合する")
    p_build.add_argument("--out", required=True, type=Path, help="出力先 HTML")
    p_build.add_argument("--title", required=True, help="<title> に入れるページ名")
    p_build.add_argument("--source", default=None,
                         help="原本の仕様書（例: docs/plans/foo.md）。タブバーの出典表示と整合性チェックに使う")
    p_build.add_argument("--view", action="append", required=True, metavar="ラベル=パス",
                         help="束ねるビュー。指定順にタブが並ぶ。繰り返し指定可")

    p_full = sub.add_parser("fulltext", help="原本 Markdown から全文ビューを機械変換する")
    p_full.add_argument("--spec", required=True, type=Path, help="原本の仕様書 Markdown")
    p_full.add_argument("--out", required=True, type=Path, help="出力先ビュー HTML")

    p_check = sub.add_parser("check", help="生成物の安全検査のみ実行する")
    p_check.add_argument("paths", nargs="+", type=Path)

    p_refresh = sub.add_parser(
        "refresh", help="改訂された仕様書の全文ビューと結合 HTML を再生成する（バンドルがあるものだけ）")
    p_refresh.add_argument("--spec", action="append", type=Path, default=[],
                           help="対象の仕様書。繰り返し指定可。省略時は --all が必要")
    p_refresh.add_argument("--all", action="store_true", help="docs/plans/*.md をすべて対象にする")
    p_refresh.add_argument("--check", action="store_true",
                           help="再生成せず、古いものがあれば列挙して exit 1")

    args = parser.parse_args()

    if args.command == "build":
        build([_parse_view(v) for v in args.view], args.out, args.title, args.source)
        sys.exit(1 if check(args.out) else 0)

    if args.command == "fulltext":
        if not args.spec.is_file():
            sys.exit(f"仕様書が見つからない: {args.spec}")
        fulltext(args.spec, args.out)
        sys.exit(1 if check(args.out) else 0)

    if args.command == "refresh":
        if args.all:
            specs = sorted(PLANS_DIR.glob("*.md"))
        else:
            # フックから素性の分からないパスが来るので、docs/plans 直下の .md 以外は黙って捨てる
            specs = [p for p in (q.resolve() for q in args.spec)
                     if p.is_file() and p.suffix == ".md" and p.parent == PLANS_DIR]
        if not specs and not args.all and not args.spec:
            sys.exit("refresh には --spec か --all が要る")
        sys.exit(refresh(specs, args.check))

    total = sum(check(p) for p in args.paths)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
