export function isGa4ReauthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid_grant') ||
    lower.includes('token has been expired') ||
    lower.includes('token has been revoked') ||
    lower.includes('insufficient permissions') ||
    lower.includes('permission_denied') ||
    lower.includes('insufficientpermissions')
  );
}
