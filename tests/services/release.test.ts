import { describe, it, expect } from 'vitest'
import { qualifiesRelease, type ReleaseFacts } from '../../main/core/release'
const release: ReleaseFacts = { packaged: true, production: true, test: false, platform: 'darwin', arch: 'arm64', electron: '41.10.3' }
describe('admission native de livraison', () => {
  it('admet uniquement le bundle et moteur qualifiés', () => { expect(qualifiesRelease(release)).toBe(true) })
  it.each([{ packaged: false }, { production: false }, { test: true }, { platform: 'linux' }, { platform: 'win32' }, { arch: 'x64' }, { electron: '41.10.4' }, { electron: undefined }])('refuse une variante non qualifiée %j', patch => {
    expect(qualifiesRelease({ ...release, ...patch })).toBe(false)
  })
})
