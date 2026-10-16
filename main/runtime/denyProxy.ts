import { createServer, type Socket } from 'node:net'

// No parser, DNS resolution, CONNECT tunnelling or forwarding. Every accepted
// connection receives a denial. Keeping the port owned avoids port-reuse races.
export async function createDenyProxy() {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    if (sockets.size >= 64) { socket.destroy(); return }
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(1000, () => socket.destroy())
    socket.once('data', () => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'))
    socket.resume()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  // Failure of this local sink still leaves Chromium configured with a fixed
  // proxy, never DIRECT. Failures do not switch back to system proxy settings.
  server.on('error', () => {})
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Proxy unavailable') }
  return { url: `http://127.0.0.1:${address.port}`, close() { for (const socket of sockets) socket.destroy(); server.close() } }
}
