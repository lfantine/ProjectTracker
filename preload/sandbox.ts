import { installRuntimePreload } from './runtime'
// Disposable native prevalidation/migration windows only, not package frames.
installRuntimePreload(window.location.origin)
