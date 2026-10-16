import type { App } from 'electron'
import { AppError } from '../../shared/errors'
let configured = false
// Process-wide and pre-ready: all Chromium DNS is denied, including WebRTC
// hostname lookups/speculative DNS that need not traverse webRequest.
// The sole exclusion is the literal loopback proxy IP (no DNS query).
// Node DNS/HTTPS remains independent. Runtime shells must use app:// resources.
export function configureRuntimeChromium(app: Pick<App, 'isReady' | 'commandLine'>) {
  if (app.isReady()) throw new AppError('UNAVAILABLE', 'Politique Chromium requise avant initialisation.')
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
  app.commandLine.appendSwitch('dns-prefetch-disable')
  configured = true
}
export function requireRuntimeChromiumPolicy() {
  if (!configured) throw new AppError('UNAVAILABLE', 'Politique réseau Chromium non initialisée.')
}
