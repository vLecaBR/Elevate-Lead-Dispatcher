import type { LeadStatus } from '@/lib/api';
import { STATUS_LABEL } from '@/lib/format';

// Shape carries meaning, color only reinforces it: hollow square = still open, solid
// square = final outcome. The label is always written next to it.
const FINAL: Partial<Record<LeadStatus, string>> = {
  sale: 'bg-positive border-positive',
  refund: 'bg-accent border-accent',
  invalid: 'bg-muted border-muted',
};

export function StatusMark({ status }: { status: LeadStatus }) {
  const final = FINAL[status];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={`inline-block size-2 border ${
          final ?? (status === 'new' ? 'border-muted' : 'border-ink')
        }`}
      />
      <span className={status === 'new' ? 'text-muted' : undefined}>{STATUS_LABEL[status]}</span>
    </span>
  );
}
