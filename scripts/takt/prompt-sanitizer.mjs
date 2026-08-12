/**
 * Remove TAKT's auto-generated report/run paths from an agent prompt.
 *
 * Report persistence remains TAKT's responsibility. Only the prompt context
 * is sanitized, so the agent cannot use the injected path as a discovery hint.
 */
export function sanitizeClaudePrompt(prompt) {
  return prompt
    .replace(/^\s*-\s*Report Directory:\s*.*$/gm, '')
    .replace(/^\s*-\s*Report File:\s*.*$/gm, '')
    .replace(/^\s*-\s*Report Files:\s*$(?:\n^\s*-\s+[^:\n]+:\s+.*$)*/gm, '')
    .replace(
      /(?:\/[^\s`"'<>]+)?\.takt\/runs\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g,
      '[TAKT run path omitted]',
    )
    .replace(/\n{3,}/g, '\n\n');
}
