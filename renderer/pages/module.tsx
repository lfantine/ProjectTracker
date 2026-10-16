import { useState } from 'react'
import { useComposition } from '../lib/composition'
import { useRouter } from 'next/router'
import { parseModuleRoute } from '../../shared/navigation'
import { AppShell } from '../components/AppShell'
import { ModuleHost } from '../components/ModuleHost'

export default function ModulePage() {
  const router = useRouter()
  const route = parseModuleRoute(router.query)
  const { snapshot } = useComposition()
  const [presentationTitle, setPresentationTitle] = useState<string | undefined>()
  const title = presentationTitle ?? (route.ok ? snapshot?.contributions.find(item => item.type === 'major' && item.ref.packageId === route.major.packageId && item.ref.contributionId === route.major.contributionId)?.name ?? 'Module indisponible' : 'Module')
  return <AppShell title={title}>{!router.isReady ? <p>Chargement…</p> : route.ok
    ? <ModuleHost onTitle={setPresentationTitle} request={{ kind: 'major', major: route.major, ...(route.instanceId ? { instanceId: route.instanceId } : {}) }} />
    : <p role="status">Adresse de module invalide.</p>}</AppShell>
}
