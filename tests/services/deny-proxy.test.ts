import { createConnection } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createDenyProxy } from '../../main/runtime/denyProxy'
describe('proxy local sans forwarding', () => {
  it('refuse CONNECT et HTTP sans résoudre ou contacter la cible', async () => {
    const proxy = await createDenyProxy(), url = new URL(proxy.url)
    try {
      for (const request of ['CONNECT secret.invalid:443 HTTP/1.1\r\n\r\n', 'GET http://secret.invalid/ HTTP/1.1\r\n\r\n']) {
        const response = await new Promise<string>((resolve, reject) => {
          const socket = createConnection({host:url.hostname,port:Number(url.port)},()=>socket.write(request));let data=''
          socket.on('data',chunk=>data+=chunk);socket.on('end',()=>resolve(data));socket.on('error',reject)
        })
        expect(response).toMatch(/^HTTP\/1.1 403 Forbidden/)
      }
    } finally {proxy.close()}
  })
})
