import fs from 'fs'

// Exclusive lock on a data directory. Acquired before migrations and package
// installations so that two application instances never drive the same data.

export interface DataLock {
  release(): void
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function acquireDataLock(lockFile: string): DataLock | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      fs.closeSync(fd)
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try {
            const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { pid?: number }
            if (owner.pid === process.pid) fs.rmSync(lockFile, { force: true })
          } catch {
            // Already removed.
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: { pid?: number } = {}
      try {
        owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
      } catch {
        // Another process may have created the file but not written its owner
        // yet. Never steal that lock during initialization.
        try { if (Date.now() - fs.statSync(lockFile).mtimeMs < 30_000) return null }
        catch { continue }
      }
      if (owner.pid !== undefined && processAlive(owner.pid)) return null
      // Stale lock left by a crashed process.
      fs.rmSync(lockFile, { force: true })
    }
  }
  return null
}
