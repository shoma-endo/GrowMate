export function isInstagramReauthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('oauthexception') ||
    message.includes('error code 190') ||
    message.includes('code":190') ||
    message.includes('invalid oauth access token') ||
    message.includes('session has expired') ||
    message.includes('token is invalid') ||
    message.includes('token has expired')
  );
}
