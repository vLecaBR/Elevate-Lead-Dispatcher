'use client';

import { useCatalog } from '@/lib/catalog';
import type { FilterKey, Filters } from '@/lib/filters';
import { STATUS_LABEL } from '@/lib/format';

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, value: string) => void;
  onClear: () => void;
  showCallCenter: boolean;
}

// Every control has a visible label; changes apply at once (no "Apply" button) and are
// mirrored in the URL by the parent.
export function LeadFilters({ filters, onChange, onClear, showCallCenter }: Props) {
  const { data: catalog } = useCatalog();
  const funnels = catalog?.products.find((p) => p.slug === filters.product)?.funnels ?? [];
  const active = Object.keys(filters).length;

  return (
    <form
      role="search"
      aria-label="Filtrar leads"
      onSubmit={(event) => event.preventDefault()}
      className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-rule py-4 sm:grid-cols-4 xl:grid-cols-8"
    >
      <Select
        id="f-product"
        label="Produto"
        value={filters.product}
        onChange={(v) => onChange('product', v)}
        options={catalog?.products.map((p) => [p.slug, p.name]) ?? []}
      />
      <Select
        id="f-funnel"
        label="Funil"
        value={filters.funnel}
        onChange={(v) => onChange('funnel', v)}
        options={funnels.map((f) => [f.slug, f.slug])}
        disabled={!filters.product}
        hint={!filters.product ? 'Escolha um produto' : undefined}
      />
      <Select
        id="f-status"
        label="Status"
        value={filters.status}
        onChange={(v) => onChange('status', v)}
        options={catalog?.statuses.map((s) => [s, STATUS_LABEL[s]]) ?? []}
      />
      {showCallCenter && (
        <Select
          id="f-cc"
          label="Call center"
          value={filters.call_center}
          onChange={(v) => onChange('call_center', v)}
          options={catalog?.call_centers.map((c) => [c.slug, c.name]) ?? []}
        />
      )}
      <Select
        id="f-source"
        label="Origem"
        value={filters.source}
        onChange={(v) => onChange('source', v)}
        options={catalog?.sources.map((s) => [s, s]) ?? []}
      />
      <DateInput
        id="f-from"
        label="De"
        value={filters.from}
        onChange={(v) => onChange('from', v)}
      />
      <DateInput id="f-to" label="Até" value={filters.to} onChange={(v) => onChange('to', v)} />
      <div className="flex items-end">
        <button
          type="button"
          onClick={onClear}
          disabled={active === 0}
          className="btn btn-quiet -ml-3"
        >
          Limpar{active > 0 && <span className="num">({active})</span>}
        </button>
      </div>
    </form>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1 block">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        title={hint}
        className="field disabled:opacity-50"
      >
        <option value="">Todos</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1 block">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="field num"
      />
    </div>
  );
}
