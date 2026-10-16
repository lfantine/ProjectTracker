import type { ApiHandler } from '../main/preload'

declare global {
  interface Window {
    api: ApiHandler
  }
}
