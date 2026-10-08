/** max_tokens で途切れた応答の続きだけを出させる指示文。手動の続き生成と Instagram の自動作成で同じ文を使う */
export const CONTINUATION_INSTRUCTION =
  '返答がmax_tokensにより途中で途切れました。途切れた箇所の続きのみを出力してください。冒頭から繰り返さないこと。';

/**
 * 履歴の末尾が user なら、今回の入力と結合して1つの user メッセージにする。
 * Anthropic API は user / assistant の交互配置を要求するため、連続する user メッセージを防ぐ
 */
export function mergeTrailingUserMessage<T extends { role: string; content: string }>(
  history: readonly T[],
  input: string
): { messages: T[]; userMessage: string } {
  const messages = [...history];
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== 'user') return { messages, userMessage: input };
  messages.pop();
  return { messages, userMessage: `${lastMessage.content}\n\n${input}` };
}
