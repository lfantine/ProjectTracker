import { beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { importConfirmationText, nativeImportConfirmation, nativeStopConfirmation, nativeActivationConfirmation, type ImportProposal } from '../../main/packages/consent'
vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }))
const proposal = (): ImportProposal => ({
  manifest: { ...JSON.parse(readFileSync('tests/fixtures/manifests/valid/major-only.json', 'utf8')), permissions: { core: { projects: ['read', 'write'] }, network: ['https://example.com'] } },
  contentSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64),
  previousPermissions: { core: { projects: ['read'] }, network: [], exports: [] },
})
beforeEach(() => vi.resetAllMocks())
it('shows full requested rights, added rights, technical identity and unsigned warning', () => {
  const text = importConfirmationText(proposal())
  expect(text).toContain('Éditeur non vérifié')
  expect(text).toContain('example.boards — 1.0.0')
  expect(text).toContain('Lire les projets')
  expect(text.split('Droits supplémentaires :')[1]).not.toContain('Lire les projets')
  expect(text.split('Droits supplémentaires :')[1]).toContain('Modifier les projets')
  expect(text).toContain('Contacter https://example.com')
  expect(text).toContain('a'.repeat(64))
  expect(text).toContain('b'.repeat(64))
})
it('uses a native cancel-by-default dialog and accepts only explicit approval', async () => {
  const window = { isDestroyed: () => false } as BrowserWindow
  const confirm = nativeImportConfirmation(window)
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  expect(await confirm(proposal())).toBe(false)
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  expect(await confirm(proposal())).toBe(true)
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window, expect.objectContaining({ defaultId: 0, cancelId: 0, noLink: true, buttons: ['Annuler', 'Importer sans activer'] }))
})
it('refuses aborted/destroyed owners, including while the dialog is pending', async () => {
  const controller = new AbortController()
  const window = { isDestroyed: () => false } as BrowserWindow
  vi.mocked(dialog.showMessageBox).mockImplementationOnce(async () => {
    controller.abort()
    return { response: 1, checkboxChecked: false }
  })
  expect(await nativeImportConfirmation(window)(proposal(), controller.signal)).toBe(false)
  expect(await nativeImportConfirmation(window)(proposal(), controller.signal)).toBe(false)
  expect(await nativeImportConfirmation({ isDestroyed: () => true } as BrowserWindow)(proposal())).toBe(false)
  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
})

it('confirms uninstall with the full dependant list and conservation warning', async () => {
  const window = { isDestroyed: () => false } as BrowserWindow
  const proposal = { packageId: 'example.provider', action: 'uninstall' as const, suspendedDependants: ['example.consumer', 'example.indirect'] }
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  expect(await nativeStopConfirmation(window)(proposal)).toBe(true)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: ['Annuler', 'Désinstaller'], detail: expect.stringContaining('example.indirect') }))
  const controller = new AbortController()
  controller.abort()
  expect(await nativeStopConfirmation(window)(proposal, controller.signal)).toBe(false)
  expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
})

it('shows full and widened rights before activation, with cancellation by default', async () => {
  const window = { isDestroyed: () => false } as BrowserWindow
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
  expect(await nativeActivationConfirmation(window)({packageId:'example.boards',version:'1.1.0',contentSha256:'a'.repeat(64),permissions:{core:{notes:['read','write']},network:[],exports:[]},previousPermissions:{core:{notes:['read']},network:[],exports:[]}})).toBe(true)
  expect(dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({defaultId:0,cancelId:0,buttons:['Annuler','Valider et activer'],detail:expect.stringContaining('Modifier les notes')}))
})
