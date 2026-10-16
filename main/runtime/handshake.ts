import { AppError } from '../../shared/errors'
import { SDK_HELLO, SDK_WELCOME, type SdkWelcome } from '../../shared/sdk'
import { SDK_VERSION } from '../../shared/version'
import { ContextRegistry } from './contexts'
import { SdkBroker, type BrokerPort } from './broker'

// Native half of negotiation. A trusted adapter has ALREADY checked the shell
// IPC sender AND the frame's event.source / exact Chromium origin before this
// function is called. The contextId is its registered map value, never hello.
export function negotiateSdk(contexts: ContextRegistry, broker: SdkBroker, contextId: string, hello: unknown, port: BrokerPort): { welcome: SdkWelcome; session: ReturnType<SdkBroker['open']> } {
  if (!hello || typeof hello !== 'object' || Array.isArray(hello)) throw new AppError('VALIDATION', 'Négociation SDK invalide.')
  const input = hello as Record<string, unknown>
  if (Object.keys(input).length !== 2 || input.type !== SDK_HELLO || typeof input.sdkVersion !== 'string') throw new AppError('VALIDATION', 'Négociation SDK invalide.')
  // SDK v1 is shipped with the host; no arbitrary remote client/version code.
  if (input.sdkVersion !== SDK_VERSION) throw new AppError('INCOMPATIBLE', 'Version SDK incompatible.')
  const context = contexts.get(contextId)
  contexts.ready(contextId) // Single-use; a replay can never replace the port.
  try {
    const session = broker.open(contextId, port)
    return { welcome: { type: SDK_WELCOME, hostApi: context.hostApi, context }, session }
  } catch (error) {
    contexts.revoke(contextId)
    throw error
  }
}
