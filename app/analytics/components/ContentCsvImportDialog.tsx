'use client';

import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { ImportResultCount } from '../../wordpress-import/WordPressImportClient';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoTooltipButton } from '@/components/ContentAnnotationSummaryAction';
import {
  buildContentCsvImportBatches,
  buildContentCsvTemplate,
  ContentCsvImportParseError,
  contentCsvTemplateHeaders,
  decodeContentCsv,
  parseContentCsv,
  type ContentCsvImportRow,
  type ContentCsvSkippedRow,
  type ParsedContentCsv,
} from '@/lib/content-csv-import';
import { importContentCsvRows } from '@/server/actions/contentCsvImport.actions';
import { isEmailLinkConflictResult, replaceToEmailLinkConflictLogin } from '@/lib/auth/emailLinkConflictClient';
import { cn } from '@/lib/utils';
import type { AnnotationFieldKey } from '@/types/annotation';

type ImportPhase = 'ready' | 'error' | 'running' | 'failed' | 'done';

interface ImportTotals {
  updated: number;
  created: number;
  unchanged: number;
  skipped: ContentCsvSkippedRow[];
}

const EMPTY_TOTALS: ImportTotals = { updated: 0, created: 0, unchanged: 0, skipped: [] };

const COLUMN_DESCRIPTIONS: Record<'url' | AnnotationFieldKey, string> = {
  url: '公開中の記事ページの URL（ブラウザで開いたときのアドレス。http:// または https:// から）。管理画面やプレビューの URL ではありません。',
  main_kw: '記事の主となる検索キーワード',
  kw: '関連する検索キーワード（複数は改行区切り）',
  impressions: '表示回数や検索ボリュームの情報',
  needs: '検索する人が知りたいこと',
  persona: '想定する読者像',
  goal: '読み終えた読者に取ってほしい行動',
  prep: '主張・理由・具体例・結論',
  basic_structure: '導入や見出しの構成',
  opening_proposal: '書き出しの方向性や冒頭で伝えたい内容',
};

export function ContentCsvImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>('ready');
  const [parsed, setParsed] = useState<ParsedContentCsv | null>(null);
  const [parseError, setParseError] = useState('');
  const [failure, setFailure] = useState('');
  const [processed, setProcessed] = useState(0);
  const [totals, setTotals] = useState<ImportTotals>(EMPTY_TOTALS);

  const reset = () => {
    setPhase('ready');
    setParsed(null);
    setParseError('');
    setFailure('');
    setProcessed(0);
    setTotals(EMPTY_TOTALS);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (phase === 'running' && !nextOpen) return;
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  const downloadTemplate = () => {
    const objectUrl = URL.createObjectURL(new Blob([buildContentCsvTemplate()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'コンテンツ情報_取り込みテンプレート.csv';
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    reset();
    if (!file) return;

    try {
      const csvText = decodeContentCsv(new Uint8Array(await file.arrayBuffer()));
      setParsed(parseContentCsv(csvText));
      setPhase('ready');
    } catch (error) {
      if (!(error instanceof ContentCsvImportParseError)) {
        console.error('[content-csv-import] file parsing failed:', error);
      }
      const message = error instanceof ContentCsvImportParseError
        ? ERROR_MESSAGES.CONTENT_CSV_IMPORT[error.code]
        : ERROR_MESSAGES.CONTENT_CSV_IMPORT.MALFORMED_CSV;
      setParseError(message);
      setPhase('error');
    }
  };

  const importRows = async (rows: ContentCsvImportRow[], parsedFile: ParsedContentCsv) => {
    const batches = buildContentCsvImportBatches(rows);
    const totalRows = parsedFile.rows.length + parsedFile.skipped.length + parsedFile.duplicateCount;
    let nextTotals: ImportTotals = {
      ...EMPTY_TOTALS,
      skipped: [...parsedFile.skipped],
    };
    let nextProcessed = parsedFile.skipped.length + parsedFile.duplicateCount;
    setTotals(nextTotals);
    setProcessed(nextProcessed);
    setFailure('');
    setPhase('running');

    for (const batch of batches) {
      const result = await importContentCsvRows({ rows: batch });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        setFailure(result.error ?? ERROR_MESSAGES.CONTENT_CSV_IMPORT.IMPORT_FAILED);
        setProcessed(nextProcessed);
        setTotals(nextTotals);
        setPhase('failed');
        return;
      }
      if (!result.data) {
        setFailure(ERROR_MESSAGES.CONTENT_CSV_IMPORT.IMPORT_FAILED);
        setProcessed(nextProcessed);
        setTotals(nextTotals);
        setPhase('failed');
        return;
      }
      nextTotals = {
        updated: nextTotals.updated + result.data.updated,
        created: nextTotals.created + result.data.created,
        unchanged: nextTotals.unchanged + result.data.unchanged,
        skipped: [...nextTotals.skipped, ...result.data.skipped].sort((left, right) => left.rowNumber - right.rowNumber),
      };
      nextProcessed += batch.length;
      setTotals(nextTotals);
      setProcessed(nextProcessed);
    }

    router.refresh();
    setProcessed(totalRows);
    setPhase('done');
  };

  const handleImport = async () => {
    if (!parsed || phase === 'running') return;
    try {
      await importRows(parsed.rows, parsed);
    } catch (error) {
      console.error('[content-csv-import] batch processing failed:', error);
      setFailure(ERROR_MESSAGES.CONTENT_CSV_IMPORT.IMPORT_FAILED);
      setPhase('failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}>
          <Upload className="w-4 h-4" aria-hidden />
          <span>CSV で取り込む</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-screen max-w-3xl overflow-y-auto"
        aria-describedby={undefined}
        hideCloseButton={phase === 'running'}
        onEscapeKeyDown={event => { if (phase === 'running') event.preventDefault(); }}
        onPointerDownOutside={event => { if (phase === 'running') event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>CSV で取り込む</DialogTitle>
        </DialogHeader>
        <section className="space-y-3 rounded-md border p-4">
          <h3 className="font-medium">1. テンプレートをダウンロード</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={downloadTemplate} className="h-9 inline-flex items-center gap-2">
              <Download className="w-4 h-4" aria-hidden />
              <span>テンプレート（CSV）</span>
            </Button>
            <InfoTooltipButton ariaLabel="テンプレートの使い方">
              <ul className="list-disc space-y-1 pl-4">
                <li>1行目の見出しは変えないでください。1記事につき1行です。</li>
                <li>分からない項目は空欄のままにしてください。</li>
                <li>Excel で保存するときは、ファイルの種類で「CSV UTF-8（コンマ区切り）」を選んでください。</li>
              </ul>
            </InfoTooltipButton>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>見出し</TableHead><TableHead>必須</TableHead><TableHead>列の定義</TableHead></TableRow></TableHeader>
            <TableBody>
              {contentCsvTemplateHeaders().map(({ key, label }) => (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell>{key === 'url' ? '必須' : '任意'}</TableCell>
                  <TableCell>{COLUMN_DESCRIPTIONS[key]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <section className="space-y-3 rounded-md border p-4">
          <h3 className="font-medium">2. 作った CSV を選ぶ</h3>
          <p className="text-sm text-muted-foreground">UTF-8・最大2万行</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept=".csv,text/csv" aria-label="CSV ファイルを選択" onClick={event => { event.currentTarget.value = ''; reset(); }} onChange={handleFileChange} disabled={phase === 'running'} />
            <Button type="button" onClick={handleImport} disabled={!parsed || phase === 'running'}>取り込む</Button>
          </div>
        </section>
        {phase === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>{ERROR_MESSAGES.CONTENT_CSV_IMPORT.PARSE_FAILED_TITLE}</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}
        {phase === 'running' && parsed && (
          <section aria-live="polite" className="space-y-2">
            <h3 className="font-medium">取り込み中</h3>
            <p>処理済み {processed.toLocaleString()} / {(parsed.rows.length + parsed.skipped.length + parsed.duplicateCount).toLocaleString()} 件</p>
            <progress className="w-full" max={parsed.rows.length + parsed.skipped.length + parsed.duplicateCount} value={processed} />
            <p className="text-sm text-muted-foreground">完了までダイアログを閉じられません。</p>
          </section>
        )}
        {phase === 'failed' && (
          <Alert variant="destructive">
            <AlertTitle>{ERROR_MESSAGES.CONTENT_CSV_IMPORT.IMPORT_STOPPED_TITLE}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>処理済み {processed.toLocaleString()} 件。{failure}</p>
              <Button type="button" variant="outline" onClick={handleImport}>同じファイルで再試行</Button>
            </AlertDescription>
          </Alert>
        )}
        {phase === 'done' && parsed && (
          <section className="space-y-3">
            <h3 className="font-medium">取り込み完了</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ImportResultCount count={totals.updated} label="更新" tone="indigo" />
              <ImportResultCount count={totals.created} label="新規作成" tone="green" />
              <ImportResultCount count={totals.unchanged} label="変更なし" tone="orange" />
              <ImportResultCount count={totals.skipped.length} label="スキップ" tone="red" />
              <ImportResultCount count={parsed.duplicateCount} label="重複" tone="yellow" />
            </div>
            {totals.skipped.length > 0 && (
              <div>
                <h4 className="font-medium">スキップした行</h4>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                  {totals.skipped.map((row, index) => (
                    <li key={`${row.rowNumber}-${row.reason}-${index}`}>
                      行 {row.rowNumber} · {row.url} · {ERROR_MESSAGES.CONTENT_CSV_IMPORT.SKIP_REASONS[row.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>閉じる</Button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
