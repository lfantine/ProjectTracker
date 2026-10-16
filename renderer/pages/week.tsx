import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { ModuleHost } from '../components/ModuleHost'

// Compatibility URL only: all business state now belongs to the package/SDK.
export default function WeekPage() {
  const [title, setTitle] = useState<string | undefined>()
  return <AppShell title={title ?? 'Semaine type'}><ModuleHost onTitle={setTitle} request={{ kind: 'major', major: { packageId: 'builtin.week', contributionId: 'planner' } }} /></AppShell>
}
