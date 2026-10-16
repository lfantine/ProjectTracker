import type { CommandParams, NativeBatchStep, NativeCommandName } from '../../shared/commands'

const fields = ['id', 'projectId', 'noteId', 'errorId', 'block.refId'] as const

// Only explicit identifier fields can reference previous creation results.
// Text/content is never interpreted as a command, template or reference.
export class NativeBatch {
  readonly steps: NativeBatchStep[] = []
  private references = new Map<string, number>()

  add<K extends Exclude<NativeCommandName, 'core.batch'>>(name: K, params: CommandParams<K>): { id: string } {
    const bindings: NonNullable<NativeBatchStep['bindings']> = []
    for (const field of fields) {
      const value = field === 'block.refId' ? (params as { block?: { refId?: unknown } }).block?.refId : (params as Record<string, unknown>)[field]
      const resultIndex = typeof value === 'string' ? this.references.get(value) : undefined
      if (resultIndex !== undefined) bindings.push({ field, resultIndex })
    }
    const id = `batch-result-${this.steps.length}`
    this.references.set(id, this.steps.length)
    this.steps.push({ name, params: params as Record<string, unknown>, ...(bindings.length ? { bindings } : {}) })
    return { id }
  }

  resolveRoute(route: string, results: unknown[]): string {
    return route.replace(/batch-result-(\d+)/g, (reference, index) => {
      const result = results[Number(index)] as { id?: string } | undefined
      if (!result?.id) throw new Error(`Résultat manquant : ${reference}`)
      return encodeURIComponent(result.id)
    })
  }
}
