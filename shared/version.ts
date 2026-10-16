// Versions of the host-side contracts. A package declares the host API range it
// supports in `hostApi`; extensions targeting `core` compare against
// CORE_VERSION.
export const MANIFEST_VERSION = 1
export const HOST_API_VERSION = '1.0.0'
export const SDK_VERSION = '1.0.0'
export const CORE_VERSION = '1.0.0'

// Icons the host can draw for contributions and sidebar entries. Packages
// pick from this closed list; they cannot inject SVG into the shell.
export const HOST_ICONS = [
  'home',
  'folder',
  'note',
  'alert',
  'search',
  'settings',
  'sparkles',
  'calendar',
  'terminal',
  'code',
  'link',
  'image',
  'chart',
  'video',
  'store',
  'shopping-bag',
  'check',
  'pin',
  // Appended in 1.0.x: older hosts reject them in a manifest, never reorder.
  'star',
  'heart',
  'flag',
  'bookmark',
  'bell',
  'mail',
  'message',
  'user',
  'users',
  'briefcase',
  'book',
  'graduation',
  'lightbulb',
  'target',
  'rocket',
  'trophy',
  'zap',
  'clock',
  'map',
  'globe',
  'music',
  'camera',
  'coffee',
  'gift',
  'wallet',
  'dumbbell',
  'leaf',
  'palette',
  'puzzle',
  'linkedin',
  'shield',
  'sun',
  'moon',
  'cloud',
  'lock',
  'phone',
] as const

export type HostIcon = (typeof HOST_ICONS)[number]
