import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'

/** Native app-owned directories only. Reject replaced roots/parents instead of
 * following links during cleanup or rename. Not a lock against hostile OS-level
 * concurrent writers: the app data lock and exclusive ownership remain required.
 */
export async function packageDirectory(root: string, relative: string, create: boolean): Promise<boolean> {
  if (!path.isAbsolute(root) || path.isAbsolute(relative) || relative.split(path.sep).some(part => part === '..' || part === '.')) throw Error('INSTALL_PATH_INVALID')
  let current = root
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part)
    if (create) await mkdir(current, { recursive: true })
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('INSTALL_DIRECTORY_INVALID')
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  return true
}
