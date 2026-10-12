import type { AppData } from './types'
import { normalizeWakeTimes, normalizeWeekSlots, type WeekSlot } from './weekSchedule'

export interface WeekPreset { id: string; name: string; slots: WeekSlot[]; wakeTimes: string[] }
export function normalizeWeekPresets(raw: unknown, activeId: unknown, slots: unknown, wakeTimes: unknown) {
  const presets: WeekPreset[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name.trim() || presets.some((p) => p.id === entry.id)) continue
    presets.push({ id: entry.id, name: entry.name.trim(), slots: normalizeWeekSlots(entry.slots), wakeTimes: normalizeWakeTimes(entry.wakeTimes) })
  }
  if (!presets.length) presets.push({ id: 'week-default', name: 'Ma semaine', slots: normalizeWeekSlots(slots), wakeTimes: normalizeWakeTimes(wakeTimes) })
  const active = presets.find((preset) => preset.id === activeId) || presets[0]
  return { weekPresets: presets, activeWeekPresetId: active.id, weekSlots: active.slots, wakeTimes: active.wakeTimes }
}
function weeks(data: AppData) {
  return normalizeWeekPresets(data.weekPresets, data.activeWeekPresetId, data.weekSlots, data.wakeTimes)
}
export function updateActiveWeek(data: AppData, patch: Partial<Pick<WeekPreset, 'slots' | 'wakeTimes'>>): AppData {
  const current = weeks(data)
  const presets = current.weekPresets.map((preset) => preset.id === current.activeWeekPresetId ? { ...preset, ...patch } : preset)
  return { ...data, ...normalizeWeekPresets(presets, current.activeWeekPresetId, [], []) }
}
export function selectWeekPreset(data: AppData, id: string): AppData {
  const current = weeks(data)
  if (!current.weekPresets.some((preset) => preset.id === id)) return data
  return { ...data, ...normalizeWeekPresets(current.weekPresets, id, [], []) }
}
export function createWeekPreset(data: AppData, id: string, name: string, copy: boolean): AppData {
  const current = weeks(data)
  const trimmed = name.trim()
  if (!trimmed || current.weekPresets.some((preset) => preset.id === id || preset.name.toLowerCase() === trimmed.toLowerCase())) return data
  const active = current.weekPresets.find((preset) => preset.id === current.activeWeekPresetId)!
  const preset: WeekPreset = { id, name: trimmed, slots: copy ? structuredClone(active.slots) : [], wakeTimes: copy ? [...active.wakeTimes] : normalizeWakeTimes(undefined) }
  return { ...data, ...normalizeWeekPresets([...current.weekPresets, preset], id, [], []) }
}
export function renameWeekPreset(data: AppData, name: string): AppData {
  const current = weeks(data), trimmed = name.trim()
  if (!trimmed || current.weekPresets.some((preset) => preset.id !== current.activeWeekPresetId && preset.name.toLowerCase() === trimmed.toLowerCase())) return data
  return { ...data, ...normalizeWeekPresets(current.weekPresets.map((preset) => preset.id === current.activeWeekPresetId ? { ...preset, name: trimmed } : preset), current.activeWeekPresetId, [], []) }
}
