import type { ReactNode } from 'react';

// Small kicker over a modest title: the page announces itself without a hero.
export function PageHeader({
  kicker,
  title,
  aside,
}: {
  kicker: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-3">
      <div>
        <p className="label">{kicker}</p>
        <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
      </div>
      {aside}
    </div>
  );
}
