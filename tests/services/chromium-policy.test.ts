import { describe, expect, it, vi } from 'vitest'
import { configureRuntimeChromium, requireRuntimeChromiumPolicy } from '../../main/runtime/chromiumPolicy'
describe('politique DNS Chromium native',()=>{
  it('exige une initialisation pre-ready et impose les règles sans repli DNS',()=>{
    expect(requireRuntimeChromiumPolicy).toThrow()
    const appendSwitch=vi.fn()
    configureRuntimeChromium({isReady:()=>false,commandLine:{appendSwitch}} as any)
    expect(appendSwitch).toHaveBeenCalledWith('host-resolver-rules','MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
    expect(appendSwitch).toHaveBeenCalledWith('dns-prefetch-disable')
    expect(requireRuntimeChromiumPolicy).not.toThrow()
    expect(()=>configureRuntimeChromium({isReady:()=>true,commandLine:{appendSwitch}} as any)).toThrow()
  })
})
