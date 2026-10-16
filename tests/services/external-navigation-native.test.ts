import { describe, expect, it, vi } from 'vitest'
import { dialog, shell } from 'electron'
import { externalNavigationHooks } from '../../main/runtime/externalNavigation'
vi.mock('electron',()=>({dialog:{showMessageBox:vi.fn()},shell:{openExternal:vi.fn(async()=>{})}}))
describe('confirmation externe native',()=>{
  it('affiche l’URL avec annulation par défaut et transmet le signal',async()=>{
    const window={isDestroyed:()=>false}, controller=new AbortController(), hooks=externalNavigationHooks(window as any)
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({response:1,checkboxChecked:false})
    expect(await hooks.confirmExternal!({contextId:'fixture',context:{packageId:'example.fixture'} as any},'https://example.com/',controller.signal)).toBe(true)
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window,expect.objectContaining({detail:'https://example.com/',defaultId:0,cancelId:0,signal:controller.signal}))
    expect(shell.openExternal).not.toHaveBeenCalled()
    await hooks.openExternal!('https://example.com/')
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/',{activate:true})
  })
  it('ne confirme pas une fenêtre détruite ou un appel annulé',async()=>{
    const controller=new AbortController();controller.abort()
    const hooks=externalNavigationHooks({isDestroyed:()=>true} as any)
    expect(await hooks.confirmExternal!({contextId:'fixture',context:{} as any},'https://example.com/',controller.signal)).toBe(false)
  })
})
