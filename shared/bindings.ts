import { isValidContributionId, isValidOpaqueId, isValidPackageId } from './ids'

export type ContributionRef = { packageId: string; contributionId: string }

// Same contract for minor blocks and widgets:
// - none: independent component, no major instance;
// - fixed: always this instance, even if the active one changes;
// - active: follows the active instance of the major module.
export type InstanceBinding =
  | { mode: 'none' }
  | { mode: 'fixed'; major: ContributionRef; instanceId: string }
  | { mode: 'active'; major: ContributionRef }

export function sameContribution(a: ContributionRef, b: ContributionRef): boolean {
  return a.packageId === b.packageId && a.contributionId === b.contributionId
}

export function contributionKey(ref: ContributionRef): string {
  return `${ref.packageId}/${ref.contributionId}`
}

export function isContributionRef(value: unknown): value is ContributionRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  return (
    Object.keys(ref).length === 2 &&
    (ref.packageId === 'core' || isValidPackageId(ref.packageId)) &&
    isValidContributionId(ref.contributionId)
  )
}

export function isInstanceBinding(value: unknown): value is InstanceBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Record<string, unknown>
  switch (binding.mode) {
    case 'none':
      return Object.keys(binding).length === 1
    case 'active':
      return Object.keys(binding).length === 2 && isContributionRef(binding.major)
    case 'fixed':
      return Object.keys(binding).length === 3 && isContributionRef(binding.major) && isValidOpaqueId(binding.instanceId)
    default:
      return false
  }
}

// A placement must use the binding allowed by its contribution declaration:
// an independent component uses `none`; a component associated with a major
// uses `fixed` or `active` targeting exactly that major.
export function bindingMatchesDeclaration(binding: InstanceBinding, declaredMajor: ContributionRef | null): boolean {
  if (!declaredMajor) return binding.mode === 'none'
  if (binding.mode === 'none') return false
  return sameContribution(binding.major, declaredMajor)
}

export function defaultBindingFor(declaredMajor: ContributionRef | null): InstanceBinding {
  return declaredMajor ? { mode: 'active', major: declaredMajor } : { mode: 'none' }
}
