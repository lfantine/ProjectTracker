import { inflateSync } from 'node:zlib'

// Native-only PNG presentation. Never load remote URLs, SVG or native paths in
// the shell. Strip metadata and bound both compressed and decoded image sizes.
export const MAX_LOGO_BYTES = 256 * 1024
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
export function packageLogoDataUrl(bytes: Buffer): string {
  const invalid = () => { throw Error('PACKAGE_LOGO_INVALID') }
  if (bytes.length > MAX_LOGO_BYTES || !bytes.subarray(0, 8).equals(signature)) return invalid()
  const chunks: Buffer[] = [signature], data: Buffer[] = []
  let offset = 8, ended = false, header = false
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + size + 12
    if (end > bytes.length) return invalid()
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return invalid()
    if (!header && type !== 'IHDR') return invalid()
    if (type === 'IHDR') {
      if (header || size !== 13) return invalid()
      const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12)
      const depth = bytes[offset + 16], color = bytes[offset + 17]
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width > 1024 || height > 1024 || !depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) return invalid()
      header = true
    }
    if (type === 'IDAT') data.push(bytes.subarray(offset + 8, end - 4))
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(offset, end))
    else if (type[0] === type[0].toUpperCase() || ['acTL', 'fcTL', 'fdAT'].includes(type)) return invalid()
    offset = end
    if (type === 'IEND') { if (size !== 0) return invalid(); ended = true; break }
  }
  if (!ended || offset !== bytes.length || !data.length) return invalid()
  try { inflateSync(Buffer.concat(data), { maxOutputLength: 9 * 1024 * 1024 }) } catch { return invalid() }
  return `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`
}
