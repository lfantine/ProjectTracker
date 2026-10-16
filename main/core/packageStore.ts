import { AppError } from '../../shared/errors'
import { isValidOpaqueId } from '../../shared/ids'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { MajorInstance } from '../../shared/models'
import type { StoredDocument } from '../../shared/sdk'
import type { Database } from '../db/database'
import { parseJson } from './json'

// Private storage of packages: named instances of their major modules and JSON
// documents addressed by package / scope / collection / id. Packages never get
// SQL access: the broker calls these functions after checking the context.

interface InstanceRow {
  package_id: string
  major_id: string
  instance_id: string
  name: string
  position: number
  created_at: string
  updated_at: string
  revision: number
}

function instanceFrom(row: InstanceRow): MajorInstance {
  return {
    packageId: row.package_id,
    majorId: row.major_id,
    instanceId: row.instance_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  }
}

export function listInstances(db: Database, packageId: string, majorId: string): MajorInstance[] {
  return db
    .all<InstanceRow>('SELECT * FROM major_instances WHERE package_id = ? AND major_id = ? ORDER BY position, instance_id', packageId, majorId)
    .map(instanceFrom)
}

export function getInstance(db: Database, packageId: string, majorId: string, instanceId: string): MajorInstance | null {
  const row = db.get<InstanceRow>('SELECT * FROM major_instances WHERE package_id = ? AND major_id = ? AND instance_id = ?', packageId, majorId, instanceId)
  return row ? instanceFrom(row) : null
}

export function getActiveInstanceId(db: Database, packageId: string, majorId: string): string | null {
  return db.get<{ instance_id: string }>('SELECT instance_id FROM active_instances WHERE package_id = ? AND major_id = ?', packageId, majorId)?.instance_id ?? null
}

// Instance names are non-empty and unique without regard to case, per major.
export function assertInstanceName(db: Database, packageId: string, majorId: string, name: string, exceptId?: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) throw new AppError('VALIDATION', 'Le nom doit contenir entre 1 et 80 caractères.')
  const clash = listInstances(db, packageId, majorId).some((instance) => instance.instanceId !== exceptId && instance.name.toLocaleLowerCase('fr') === trimmed.toLocaleLowerCase('fr'))
  if (clash) throw new AppError('CONFLICT', 'Ce nom est déjà utilisé.')
  return trimmed
}

export function createInstance(
  db: Database,
  input: { packageId: string; majorId: string; instanceId: string; name: string; now: string; activateIfFirst?: boolean }
): MajorInstance {
  if (!isValidOpaqueId(input.instanceId)) throw new AppError('VALIDATION', 'Identifiant d’instance invalide.')
  if (getInstance(db, input.packageId, input.majorId, input.instanceId)) throw new AppError('CONFLICT', 'Cette instance existe déjà.')
  const name = assertInstanceName(db, input.packageId, input.majorId, input.name)
  const position = Number(db.get<{ next: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM major_instances WHERE package_id = ? AND major_id = ?', input.packageId, input.majorId)?.next ?? 0)
  db.run(
    'INSERT INTO major_instances (package_id, major_id, instance_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    input.packageId, input.majorId, input.instanceId, name, position, input.now, input.now
  )
  if (input.activateIfFirst !== false && !getActiveInstanceId(db, input.packageId, input.majorId)) setActiveInstance(db, input.packageId, input.majorId, input.instanceId)
  return getInstance(db, input.packageId, input.majorId, input.instanceId)!
}

export function renameInstance(db: Database, packageId: string, majorId: string, instanceId: string, name: string, now: string): MajorInstance {
  if (!getInstance(db, packageId, majorId, instanceId)) throw new AppError('NOT_FOUND', 'Instance introuvable.')
  const trimmed = assertInstanceName(db, packageId, majorId, name, instanceId)
  db.run(
    'UPDATE major_instances SET name = ?, updated_at = ?, revision = revision + 1 WHERE package_id = ? AND major_id = ? AND instance_id = ?',
    trimmed, now, packageId, majorId, instanceId
  )
  return getInstance(db, packageId, majorId, instanceId)!
}

export function setActiveInstance(db: Database, packageId: string, majorId: string, instanceId: string): void {
  if (!getInstance(db, packageId, majorId, instanceId)) throw new AppError('NOT_FOUND', 'Instance introuvable.')
  db.run(
    'INSERT INTO active_instances (package_id, major_id, instance_id) VALUES (?, ?, ?) ON CONFLICT (package_id, major_id) DO UPDATE SET instance_id = excluded.instance_id',
    packageId, majorId, instanceId
  )
}

// Removes the instance and its own documents. When it was active, the first
// remaining instance in the stored order becomes active. Fixed bindings to the
// deleted instance stay unresolved; they never switch to another instance.
export function deleteInstance(db: Database, packageId: string, majorId: string, instanceId: string): { nextActive: string | null } {
  if (!getInstance(db, packageId, majorId, instanceId)) throw new AppError('NOT_FOUND', 'Instance introuvable.')
  const wasActive = getActiveInstanceId(db, packageId, majorId) === instanceId
  db.run('DELETE FROM package_documents WHERE package_id = ? AND instance_scope = ?', packageId, instanceId)
  db.run('DELETE FROM major_instances WHERE package_id = ? AND major_id = ? AND instance_id = ?', packageId, majorId, instanceId)
  let nextActive = getActiveInstanceId(db, packageId, majorId)
  if (wasActive) {
    const first = listInstances(db, packageId, majorId)[0]
    if (first) {
      setActiveInstance(db, packageId, majorId, first.instanceId)
      nextActive = first.instanceId
    } else nextActive = null
  }
  return { nextActive }
}

// ---------------------------------------------------------------- documents

interface DocumentRow {
  package_id: string
  instance_scope: string
  collection: string
  doc_id: string
  value_json: string
  size_bytes: number
  revision: number
  updated_at: string
}

export interface DocumentAddress {
  packageId: string
  // '' for package-wide documents, the instance id otherwise.
  scope: string
  collection: string
  id: string
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function assertAddress(address: DocumentAddress) {
  if (!NAME_PATTERN.test(address.collection) || !NAME_PATTERN.test(address.id)) throw new AppError('VALIDATION', 'Collection ou identifiant de document invalide.')
  if (address.scope !== '' && !isValidOpaqueId(address.scope)) throw new AppError('VALIDATION', 'Instance invalide.')
}

function documentFrom(row: DocumentRow): StoredDocument {
  return {
    id: row.doc_id,
    collection: row.collection,
    instanceId: row.instance_scope === '' ? null : row.instance_scope,
    revision: row.revision,
    value: parseJson<unknown>(row.value_json, null),
    updatedAt: row.updated_at,
  }
}

export function getDocument(db: Database, address: DocumentAddress): StoredDocument | null {
  assertAddress(address)
  const row = db.get<DocumentRow>(
    'SELECT * FROM package_documents WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id = ?',
    address.packageId, address.scope, address.collection, address.id
  )
  return row ? documentFrom(row) : null
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function packageStorageBytes(db: Database, packageId: string): number {
  return Number(db.get<{ total: number }>('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM package_documents WHERE package_id = ?', packageId)?.total ?? 0)
}

// Writes a document. `expectedRevision`: undefined = unconditional write, null
// = must not exist yet, number = must match the stored revision. Quotas only
// apply to writes coming from packages (`enforceQuota`), never retroactively.
export function putDocument(
  db: Database,
  address: DocumentAddress,
  value: unknown,
  options: { now: string; expectedRevision?: number | null; enforceQuota?: boolean }
): StoredDocument {
  assertAddress(address)
  const json = JSON.stringify(value)
  if (json === undefined) throw new AppError('VALIDATION', 'Valeur non sérialisable.')
  const size = utf8Length(json)
  const existing = getDocument(db, address)
  if (options.expectedRevision === null && existing) throw new AppError('CONFLICT', 'Le document existe déjà.', { revision: existing.revision })
  if (typeof options.expectedRevision === 'number' && existing?.revision !== options.expectedRevision) {
    throw new AppError('CONFLICT', 'Le document a été modifié ailleurs.', { revision: existing?.revision ?? null })
  }
  if (options.enforceQuota) {
    if (size > RUNTIME_LIMITS.maxDocumentBytes) throw new AppError('STORAGE', 'Document trop volumineux.', { limit: RUNTIME_LIMITS.maxDocumentBytes })
    const previous = existing ? Number(db.get<{ size_bytes: number }>('SELECT size_bytes FROM package_documents WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id = ?', address.packageId, address.scope, address.collection, address.id)?.size_bytes ?? 0) : 0
    if (packageStorageBytes(db, address.packageId) - previous + size > RUNTIME_LIMITS.maxStorageBytesPerPackage) {
      throw new AppError('STORAGE', 'Quota de stockage du package dépassé.', { limit: RUNTIME_LIMITS.maxStorageBytesPerPackage })
    }
  }
  if (existing) {
    db.run(
      'UPDATE package_documents SET value_json = ?, size_bytes = ?, revision = revision + 1, updated_at = ? WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id = ?',
      json, size, options.now, address.packageId, address.scope, address.collection, address.id
    )
  } else {
    db.run(
      'INSERT INTO package_documents (package_id, instance_scope, collection, doc_id, value_json, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      address.packageId, address.scope, address.collection, address.id, json, size, options.now
    )
  }
  return getDocument(db, address)!
}

export function deleteDocument(db: Database, address: DocumentAddress, expectedRevision?: number): boolean {
  const existing = getDocument(db, address)
  if (!existing) return false
  if (expectedRevision !== undefined && existing.revision !== expectedRevision) throw new AppError('CONFLICT', 'Le document a été modifié ailleurs.', { revision: existing.revision })
  db.run('DELETE FROM package_documents WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id = ?', address.packageId, address.scope, address.collection, address.id)
  return true
}

// Paginated listing ordered by document id; the cursor is the last id seen.
export function listDocuments(
  db: Database,
  query: { packageId: string; scope: string; collection: string; cursor?: string; limit?: number }
): { items: StoredDocument[]; nextCursor: string | null } {
  assertAddress({ packageId: query.packageId, scope: query.scope, collection: query.collection, id: 'x' })
  const limit = Math.max(1, Math.min(query.limit ?? 50, RUNTIME_LIMITS.maxPageSize))
  const rows = db.all<DocumentRow>(
    'SELECT * FROM package_documents WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id > ? ORDER BY doc_id LIMIT ?',
    query.packageId, query.scope, query.collection, query.cursor ?? '', limit + 1
  )
  const items = rows.slice(0, limit).map(documentFrom)
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null }
}
