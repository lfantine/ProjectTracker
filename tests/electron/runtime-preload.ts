import { installRuntimePreload } from '../../preload/runtime'
// Only the isolated HTTP fixture uses this entry point.
installRuntimePreload(window.location.origin)
