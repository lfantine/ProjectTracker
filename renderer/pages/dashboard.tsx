import { useRouter } from 'next/router'
import { parseDashboardRoute } from '../../shared/navigation'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../components/DashboardPage'

export default function DashboardRoutePage() {
  const router = useRouter()
  const route = parseDashboardRoute(router.query)
  if (!router.isReady) return <AppShell title="Tableau de bord"><p>Chargement…</p></AppShell>
  return route.ok ? <DashboardPage dashboardId={route.dashboardId} /> : <AppShell title="Tableau de bord"><p role="status">Adresse de tableau de bord invalide.</p></AppShell>
}
