// Serialize filesystem/package lifecycle operations sharing an app-owned root.
// The application-level database lock is still required across app processes.
const queues = new Map<string, Promise<unknown>>()
export function serialPackageOperation<T>(root: string, action: () => Promise<T>): Promise<T> {
  const result = (queues.get(root) ?? Promise.resolve()).catch(() => {}).then(action)
  queues.set(root, result)
  void result.finally(() => { if (queues.get(root) === result) queues.delete(root) }).catch(() => {})
  return result
}
