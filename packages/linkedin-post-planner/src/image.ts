import type { StoredImage } from './model'

// Documents are limited to 1 MiB: images are re-encoded locally (canvas, no
// network) to stay well below, with a small thumbnail kept in the post itself.
export const MAX_IMAGE_CHARS = 750_000
const MAX_INPUT_BYTES = 25 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const IMAGE_ACCEPT = ACCEPTED.join(',')

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('Lecture impossible'))
    reader.onerror = () => reject(reader.error ?? Error('Lecture impossible'))
    reader.readAsDataURL(file)
  })
}
function decode(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('Image illisible'))
    // CSP allows data: images only (no blob:, no remote origin).
    image.src = source
  })
}
function encode(image: HTMLImageElement, longest: number, quality: number): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('Canvas indisponible')
  // JPEG has no transparency: LinkedIn shows transparent areas on white too.
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height }
}

export async function prepareImage(file: File): Promise<{ image: StoredImage; thumbnail: string }> {
  if (!ACCEPTED.includes(file.type)) throw Error('Format accepté : PNG, JPEG, WebP ou GIF.')
  if (file.size > MAX_INPUT_BYTES) throw Error('Image trop lourde (25 Mo maximum).')
  const decoded = await decode(await readAsDataUrl(file))
  if (!decoded.naturalWidth || !decoded.naturalHeight) throw Error('Image illisible')
  for (const [longest, quality] of [[2000, 0.88], [1600, 0.82], [1280, 0.78], [1024, 0.72], [800, 0.68]] as const) {
    const result = encode(decoded, longest, quality)
    if (result.dataUrl.length <= MAX_IMAGE_CHARS) {
      return { image: { ...result, name: file.name.slice(0, 120) || 'image.jpg' }, thumbnail: encode(decoded, 320, 0.7).dataUrl }
    }
  }
  throw Error('Image trop détaillée pour être conservée.')
}
