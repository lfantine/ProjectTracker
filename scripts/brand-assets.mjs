// Resize/pad the supplied artwork only: no redraw, crop or background change.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
const source = 'docs/logo/Amber-logo.png'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-icons-'))
async function png(size, inset = 0) {
  const inner = size - inset * 2
  return sharp(source).resize(inner, inner, { fit: 'contain', background: '#00000000' })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: '#00000000' }).png().toBuffer()
}
async function ico(sizes, target) {
  const images = await Promise.all(sizes.map(size => png(size)))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  images.forEach((image, index) => {
    const start = 6 + index * 16, size = sizes[index]
    header[start] = size === 256 ? 0 : size; header[start + 1] = header[start]
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6)
    header.writeUInt32LE(image.length, start + 8); header.writeUInt32LE(offset, start + 12)
    offset += image.length
  })
  fs.writeFileSync(target, Buffer.concat([header, ...images]))
}
try {
  fs.mkdirSync('renderer/public/images', { recursive: true })
  fs.writeFileSync('renderer/public/images/logo.png', await png(256))
  fs.writeFileSync('resources/icon.png', await png(1024, 64))
  await ico([16, 32, 48, 64, 128, 256], 'resources/icon.ico')
  await ico([16, 32, 48], 'renderer/public/favicon.ico')
  if (process.platform === 'darwin') {
    const iconset = path.join(temporary, 'amber.iconset'); fs.mkdirSync(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) fs.writeFileSync(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), await png(size * scale, Math.round(size * scale / 16)))
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'resources/icon.icns'])
  } else console.log('ICNS requires macOS iconutil; PNG/ICO generated.')
  console.log('✓ amber: original artwork preserved, transparent PNG/ICO/ICNS generated.')
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
