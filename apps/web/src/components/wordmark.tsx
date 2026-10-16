// Text-only mark: the accent square is the only ornament in the whole interface.
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-2 select-none">
      <span aria-hidden="true" className="inline-block size-2.5 translate-y-[-1px] bg-accent" />
      <span className="font-semibold tracking-tight">Elevate</span>
      {!compact && <span className="text-muted">Lead Dispatcher</span>}
    </span>
  );
}
