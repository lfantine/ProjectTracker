import { normalizeWeekPresets } from './weekPresets'
import { syncTaskStatuses } from './taskStatus'
import type { AppData, ProjectType } from '../../shared/domain'

export * from '../../shared/domain'

const DEFAULT_PLATFORMS: Record<ProjectType, string[]> = {
  dev: ['PC', 'Tablette', 'Mobile', 'Docker', 'Embarqué', 'Personnel'],
  video: ['YouTube', 'Instagram', 'TikTok', 'Twitch', 'LinkedIn', 'Autre'],
}

export function emptyCoreData(): AppData {
  return {
    categories: ['Hardware', 'Software', 'Mobile'],
    platforms: { dev: [...DEFAULT_PLATFORMS.dev], video: [...DEFAULT_PLATFORMS.video] },
    folders: [],
    projects: [],
    notes: [],
    errors: [],
    trashedNotes: [],
  }
}

// Compatibility fixture/legacy conversion only; never the live shell cache.
export function emptyAppData(): AppData {
  return { ...emptyCoreData(), ...normalizeWeekPresets(undefined, undefined, [], undefined) }
}

// Migrates on-disk data saved before ProjectType/folders/tags existed:
// `platforms` used to be a flat string[] and projects had no `type`/`tags`.
export function normalizeAppData(raw: unknown): AppData {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppData> & {
    platforms?: string[] | Record<ProjectType, string[]>
  }
  const platforms: Record<ProjectType, string[]> = Array.isArray(data.platforms)
    ? { dev: data.platforms, video: [...DEFAULT_PLATFORMS.video] }
    : {
        dev: data.platforms?.dev ?? [...DEFAULT_PLATFORMS.dev],
        video: data.platforms?.video ?? [...DEFAULT_PLATFORMS.video],
      }
  return {
    categories: data.categories ?? ['Hardware', 'Software', 'Mobile'],
    platforms,
    folders: (data.folders ?? []).map((f) => ({ ...f, displayMode: f.displayMode ?? 'category' })),
    projects: (data.projects ?? []).map((p) => ({
      ...p,
      type: p.type ?? 'dev',
      tags: p.tags ?? [],
      tasks: syncTaskStatuses(p.tasks),
    })),
    notes: data.notes ?? [],
    errors: data.errors ?? [],
    trashedNotes: data.trashedNotes ?? [],
    ...normalizeWeekPresets(data.weekPresets, data.activeWeekPresetId, data.weekSlots, data.wakeTimes),
  }
}
