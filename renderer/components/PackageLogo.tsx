import { useState } from 'react'

/** Only native-prepared PNG bytes, never the archive-relative manifest path. */
export function PackageLogo({ name, logoDataUrl }: { name: string; logoDataUrl?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const safe = logoDataUrl && logoDataUrl.length <= 350000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl)
  return safe && failed !== logoDataUrl
    ? <img className="package-logo" src={logoDataUrl} alt="" width={48} height={48} draggable={false} onError={() => setFailed(logoDataUrl)} />
    : <span className="package-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
}
