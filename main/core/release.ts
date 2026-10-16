/** Native bootstrap only. No IPC or renderer input participates in admission. */
export interface ReleaseFacts { packaged: boolean; production: boolean; platform: string; arch: string; electron: string | undefined; test: boolean }
export function qualifiesRelease(facts: ReleaseFacts): boolean {
  return facts.packaged && facts.production && !facts.test && facts.platform === 'darwin' && facts.arch === 'arm64' && facts.electron === '41.10.3'
}
let initialized = false
let admitted = false
export function initializeRelease(facts: ReleaseFacts): void {
  if (initialized) throw Error('RELEASE_ALREADY_INITIALIZED')
  initialized = true
  admitted = qualifiesRelease(facts)
}
export function isQualifiedRelease(): boolean { return admitted }
