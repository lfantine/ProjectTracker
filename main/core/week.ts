import type { WeekFacade } from '../../shared/commands'
import { WEEK_COLLECTION, WEEK_DOCUMENT_ID, WEEK_MAJOR } from '../../shared/core'
import { AppError } from '../../shared/errors'
import { normalizeWakeTimes, slotError, type WeekPreset, type WeekSlot } from '../../shared/week'
import type { Database } from '../db/database'
import { createInstance, getActiveInstanceId, getDocument, getInstance, listInstances, putDocument, renameInstance, setActiveInstance } from './packageStore'

// Data of the "Semaine type" package lives in its own storage namespace
// (builtin.week) from the very first SQLite import. These helpers are the
// trusted facade that keeps the former week screen working until the package
// UI replaces it; they never keep a second copy of the data.

const PKG = WEEK_MAJOR.packageId
const MAJOR = WEEK_MAJOR.contributionId

export interface WeekDocument {
  slots: WeekSlot[]
  wakeTimes: string[]
}

export function weekAddress(instanceId: string) {
  return { packageId: PKG, scope: instanceId, collection: WEEK_COLLECTION, id: WEEK_DOCUMENT_ID }
}

export function readWeekDocument(db: Database, instanceId: string): WeekDocument {
  const doc = getDocument(db, weekAddress(instanceId))?.value as Partial<WeekDocument> | undefined
  return { slots: Array.isArray(doc?.slots) ? doc!.slots : [], wakeTimes: normalizeWakeTimes(doc?.wakeTimes) }
}

export function readWeekFacade(db: Database): WeekFacade {
  const instances = listInstances(db, PKG, MAJOR)
  const presets: WeekPreset[] = instances.map((instance) => ({ id: instance.instanceId, name: instance.name, ...readWeekDocument(db, instance.instanceId) }))
  const active = getActiveInstanceId(db, PKG, MAJOR)
  return { weekPresets: presets, activeWeekPresetId: active ?? presets[0]?.id ?? '' }
}

export function writeWeekDocument(db: Database, instanceId: string, doc: WeekDocument, now: string) {
  putDocument(db, weekAddress(instanceId), doc, { now })
}

export function ensureWeekInstance(db: Database, now: string): string {
  const existing = getActiveInstanceId(db, PKG, MAJOR) ?? listInstances(db, PKG, MAJOR)[0]?.instanceId
  if (existing) return existing
  createInstance(db, { packageId: PKG, majorId: MAJOR, instanceId: 'week-default', name: 'Ma semaine', now })
  writeWeekDocument(db, 'week-default', { slots: [], wakeTimes: normalizeWakeTimes(undefined) }, now)
  return 'week-default'
}

function activeId(db: Database, now: string): string {
  return ensureWeekInstance(db, now)
}

export function validateSlots(slots: unknown): WeekSlot[] {
  if (!Array.isArray(slots)) throw new AppError('VALIDATION', 'Liste de créneaux attendue.')
  const accepted: WeekSlot[] = []
  for (const slot of slots as WeekSlot[]) {
    if (!slot || typeof slot.id !== 'string' || !slot.id) throw new AppError('VALIDATION', 'Créneau sans identifiant.')
    if (accepted.some((other) => other.id === slot.id)) throw new AppError('VALIDATION', 'Identifiant de créneau répété.')
    const problem = slotError(slot, accepted)
    if (problem) throw new AppError('VALIDATION', problem, { slotId: slot.id })
    accepted.push(slot)
  }
  return accepted
}

export function setActiveSlots(db: Database, slots: WeekSlot[], now: string) {
  const id = activeId(db, now)
  writeWeekDocument(db, id, { ...readWeekDocument(db, id), slots: validateSlots(slots) }, now)
}

export function setActiveWakeTimes(db: Database, wakeTimes: string[], now: string) {
  const normalized = normalizeWakeTimes(wakeTimes)
  if (!Array.isArray(wakeTimes) || wakeTimes.length !== 7 || wakeTimes.some((time, day) => time !== normalized[day])) {
    throw new AppError('VALIDATION', 'Heures de réveil invalides.')
  }
  const id = activeId(db, now)
  writeWeekDocument(db, id, { ...readWeekDocument(db, id), wakeTimes: normalized }, now)
}

export function selectWeek(db: Database, id: string) {
  if (!getInstance(db, PKG, MAJOR, id)) throw new AppError('NOT_FOUND', 'Semaine introuvable.')
  setActiveInstance(db, PKG, MAJOR, id)
}

// Former screen behaviour: the new week becomes the active one.
export function createWeek(db: Database, input: { id: string; name: string; copy: boolean; now: string }) {
  const source = activeId(db, input.now)
  const doc = input.copy ? structuredClone(readWeekDocument(db, source)) : { slots: [], wakeTimes: normalizeWakeTimes(undefined) }
  createInstance(db, { packageId: PKG, majorId: MAJOR, instanceId: input.id, name: input.name, now: input.now })
  writeWeekDocument(db, input.id, doc, input.now)
  setActiveInstance(db, PKG, MAJOR, input.id)
}

export function renameActiveWeek(db: Database, name: string, now: string) {
  renameInstance(db, PKG, MAJOR, activeId(db, now), name, now)
}
