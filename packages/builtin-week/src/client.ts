import type { ProjectTrackerSdk } from '../../../sdk/src'
import { WEEK_COLLECTION, WEEK_DOCUMENT_ID, WEEK_MAJOR } from '../../../shared/core'
import { emptyWeek, validateWeek, type WeekDocument } from './model'

export interface WeekSnapshot { instanceId: string; name: string; revision: number | null; document: WeekDocument }
type WeekSdk = Pick<ProjectTrackerSdk, 'call' | 'storage'>
/** Same namespace/document as the native transitional facade; no migration,
 * import or creation is performed by a read of the package UI. */
export async function loadWeek(sdk: WeekSdk): Promise<WeekSnapshot | null> {
  const context = await sdk.call('context.get', {})
  if (context.packageId !== WEEK_MAJOR.packageId || context.binding.mode === 'none' || (context.binding.major.packageId !== WEEK_MAJOR.packageId || context.binding.major.contributionId !== WEEK_MAJOR.contributionId)) throw Error('Contexte de semaine indisponible.')
  if (!context.instance) return null
  const address = { collection: WEEK_COLLECTION, id: WEEK_DOCUMENT_ID, scope: 'instance' as const,
    instanceId: context.instance.instanceId }
  const stored = await sdk.storage.get(address)
  // An active binding may have changed while the read was in flight. Never
  // associate another instance's data with the old snapshot identity.
  if (stored && stored.instanceId !== context.instance.instanceId) throw Error('La semaine consultée a changé. Recharge la vue.')
  return { instanceId: context.instance.instanceId, name: context.instance.name, revision: stored?.revision ?? null,
    document: stored ? validateWeek(stored.value) : emptyWeek() }
}
export async function saveWeek(sdk: WeekSdk, snapshot: WeekSnapshot, value: WeekDocument): Promise<WeekSnapshot> {
  const document = validateWeek(value)
  const context = await sdk.call('context.get', {})
  if (context.kind !== 'major' || context.packageId !== WEEK_MAJOR.packageId || context.instance?.instanceId !== snapshot.instanceId) throw Error('La semaine consultée a changé. Recharge la vue.')
  const result = await sdk.storage.put({ collection: WEEK_COLLECTION, id: WEEK_DOCUMENT_ID, scope: 'instance',
    instanceId: snapshot.instanceId, value: document, expectedRevision: snapshot.revision })
  return { ...snapshot, revision: result.revision, document }
}
