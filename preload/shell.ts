import '../main/preload'
import { installRuntimePreload } from './runtime'
if (process.isMainFrame && window.location.protocol === 'app:' && window.location.host === 'shell') installRuntimePreload('app://shell')
