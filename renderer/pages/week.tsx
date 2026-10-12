import { AppShell } from '../components/AppShell'
import { WeekSchedule } from '../components/WeekSchedule'
import { useData } from '../lib/store'
export default function WeekPage() {
  const { data, loading, setWeekSlots } = useData()
  return <AppShell title="Semaine type">{loading ? <p>Chargement…</p> : <WeekSchedule slots={data.weekSlots || []} onChange={setWeekSlots} projects={data.projects} />}</AppShell>
}
