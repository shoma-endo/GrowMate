export function isInstagramSyncEnabled(): boolean {
  return process.env.INSTAGRAM_SYNC_ENABLED !== 'false';
}
