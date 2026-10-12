import { AppShell } from '../components/AppShell'
import { WeekSchedule } from '../components/WeekSchedule'
import { WeekPresetPicker } from '../components/WeekPresetPicker'
import { useData } from '../lib/store'
export default function WeekPage() {
  const { data, loading, setWeekSlots, setWakeTimes, selectWeekPreset, createWeekPreset, renameWeekPreset } = useData()
  return <AppShell title="Semaine type">{loading ? <p>Chargement…</p> : <>
    <WeekPresetPicker presets={data.weekPresets || []} activeId={data.activeWeekPresetId} onSelect={selectWeekPreset} onCreate={createWeekPreset} onRename={renameWeekPreset} />
    <WeekSchedule key={data.activeWeekPresetId} slots={data.weekSlots || []} onChange={setWeekSlots} projects={data.projects} wakeTimes={data.wakeTimes} onWakeTimesChange={setWakeTimes} />
  </>}</AppShell>
}
