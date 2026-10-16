export function CollapsedTaskStack({ count }: { count: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full -z-10">
      {count > 1 && <span className="absolute inset-x-4 top-1 h-2 rounded-b-lg border border-t-0 border-accent/30 bg-accent-soft" />}
      <span className="absolute inset-x-2 top-0 h-1.5 rounded-b-lg border border-t-0 border-border bg-surface" />
    </span>
  )
}
