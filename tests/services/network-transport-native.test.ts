import { createServer as createHttpsServer } from 'node:https'
import fs from 'node:fs'
import { fixturesDir } from './helpers'
import { createServer, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { requestPinned } from '../../main/runtime/network'

describe('transport HTTPS natif réel (serveur TCP temporaire)', () => {
  it('refuse réellement un certificat auto-signé avant toute requête HTTP', async () => {
    let received = false
    const sockets = new Set<Socket>()
    const server = createHttpsServer({key:fs.readFileSync(`${fixturesDir}/tls/self-signed-test.key`),cert:fs.readFileSync(`${fixturesDir}/tls/self-signed-test.crt`)}, (_req,res)=>{received=true;res.end('must not be accepted')})
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
    server.on('tlsClientError',()=>{})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    try {
      const port=(server.address() as {port:number}).port
      await expect(requestPinned({url:new URL(`https://api.example.com:${port}/`),address:{address:'127.0.0.1',family:4},method:'GET',headers:{}},new AbortController().signal)).rejects.toMatchObject({code:'DEPTH_ZERO_SELF_SIGNED_CERT'})
      expect(received).toBe(false)
    } finally {for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })
  it('détruit la connexion TLS en attente quand le contexte est annulé', async () => {
    // Test only the lower-level driver. NetworkApi must and does reject this
    // loopback address before reaching it; this is not an SDK bypass option.
    let socket: Socket | undefined
    let received: () => void = () => {}
    const hello = new Promise<void>((resolve) => { received = resolve })
    const server = createServer((connection) => { socket = connection; connection.once('data', () => received()) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test port')
    const controller = new AbortController()
    try {
      const request = requestPinned({ url: new URL(`https://api.example.com:${address.port}/`), address: { address: '127.0.0.1', family: 4 }, method: 'GET', headers: {} }, controller.signal)
      const rejected = expect(request).rejects.toMatchObject({ code: 'ABORT_ERR' })
      await hello // A real TLS ClientHello reached the isolated TCP listener.
      const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()))
      controller.abort()
      await rejected
      await closed
      expect(socket!.destroyed).toBe(true)
    } finally {
      controller.abort(); socket?.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
