// Public entry of the ProjectTracker SDK for package authors.
export { connect, createClient, SdkError, SDK_VERSION } from './client'
export type { ProjectTrackerSdk, SdkContext, SdkEvent, SdkEventTopic, SdkMethod, SdkParams, SdkResults } from './client'
export type { Manifest, Contribution, ConfigSchema } from '../../shared/manifest'
export type { ContributionRef, InstanceBinding } from '../../shared/bindings'
export type { SdkErrorCode } from '../../shared/errors'

// Installed by the trusted bootstrap before any contribution script executes.
declare global {
  interface Window { readonly ProjectTracker: { readonly ready: Promise<import('./client').ProjectTrackerSdk> } }
  const ProjectTracker: { readonly ready: Promise<import('./client').ProjectTrackerSdk> }
}
