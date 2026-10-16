import { beforeEach, expect, it, vi } from 'vitest'
import { dialog, type BrowserWindow } from 'electron'
import { nativePackagePickers } from '../../main/packages/pickers'
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))
beforeEach(() => vi.resetAllMocks())
it('uses parented single-selection ZIP and directory dialogs, returning paths only to native code', async () => {
  const window = { isDestroyed: () => false } as BrowserWindow
  const pickers = nativePackagePickers(window)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/native/package.zip'] })
  expect(await pickers.archive()).toBe('/native/package.zip')
  expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(window, expect.objectContaining({ properties: ['openFile'], filters: [{ name: 'Package ZIP', extensions: ['zip'] }] }))
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/native/folder'] })
  expect(await pickers.folder()).toBe('/native/folder')
  expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(window, expect.objectContaining({ properties: ['openDirectory'] }))
})
it('refuses cancellation, multiple paths and a window destroyed while choosing', async () => {
  let destroyed = false
  const pickers = nativePackagePickers({ isDestroyed: () => destroyed } as BrowserWindow)
  for (const result of [{ canceled: true, filePaths: ['/native/private'] }, { canceled: false, filePaths: [] }, { canceled: false, filePaths: ['a', 'b'] }]) {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue(result)
    expect(await pickers.archive()).toBeNull()
  }
  vi.mocked(dialog.showOpenDialog).mockImplementation(async () => { destroyed = true; return { canceled: false, filePaths: ['/native/private'] } })
  expect(await pickers.folder()).toBeNull()
  vi.mocked(dialog.showOpenDialog).mockClear()
  expect(await pickers.archive()).toBeNull()
  expect(dialog.showOpenDialog).not.toHaveBeenCalled()
})
