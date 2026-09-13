import { describe, expect, it, vi } from 'vitest';
import { handleAsyncAction } from '@/lib/async-handler';

/**
 * handleAsyncAction が失敗レスポンス（result）を onError まで届けているかの検証。
 *
 * 要点: 以前は失敗時に result.error から new Error(...) するだけで result 自体
 * （needsReauth 等）を握りつぶしており、useGscSetup.ts/useGa4Setup.ts の onError内の
 * 再認証判定が常に機能しないという回帰バグの温床だった（result を見ずに、既に
 * 日本語化済みの error.message を英語パターンで判定していたため）。
 */
describe('handleAsyncAction', () => {
  it('成功時は onSuccess のみ呼ばれ、onError は呼ばれない', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await handleAsyncAction(async () => ({ success: true, data: 'ok' }), {
      onSuccess,
      onError,
    });

    expect(onSuccess).toHaveBeenCalledWith('ok');
    expect(onError).not.toHaveBeenCalled();
  });

  it('needsReauth:true の失敗時、onError が (error, result) の2引数で呼ばれ result.needsReauth が true', async () => {
    const onError = vi.fn();

    await handleAsyncAction(
      async () => ({ success: false, error: '認証切れ', needsReauth: true }),
      { onError }
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, result] = onError.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('認証切れ');
    expect(result?.needsReauth).toBe(true);
  });

  it('needsReauth を持たない通常の失敗時も (error, result) で呼ばれるが needsReauth は undefined', async () => {
    const onError = vi.fn();

    await handleAsyncAction(async () => ({ success: false, error: '取得失敗' }), { onError });

    expect(onError).toHaveBeenCalledTimes(1);
    const [, result] = onError.mock.calls[0]!;
    expect(result?.needsReauth).toBeUndefined();
  });

  it('例外パス（actionがthrow）では onError が result 無しで（1引数のみで）呼ばれる', async () => {
    const onError = vi.fn();

    await handleAsyncAction(
      async () => {
        throw new Error('network error');
      },
      { onError }
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]).toHaveLength(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('emailLinkConflict:true の結果では onSuccess/onError どちらも呼ばれない', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await handleAsyncAction(
      async () => ({ success: false, error: 'conflict', emailLinkConflict: true as const }),
      { onSuccess, onError }
    );

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
