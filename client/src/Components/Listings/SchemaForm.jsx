import React from 'react';
import { COLORS } from '../Shared/index.js';
import { Field, fieldStyle } from '../Actions/Dialog.jsx';

/**
 * A listing form built from Amazon's product type fields (GET
 * /api/actions/listings/fields): text, choice, number, yes/no and measure
 * (number + unit). Multiple-value text fields take one value per line.
 */
const SchemaForm = ({ fields, values, onChange, idPrefix = 'sf' }) => {
  const set = (name, v) => onChange({ ...values, [name]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.name}`;
        const v = values[f.name];
        const label = `${f.title}${f.required ? ' *' : ''}`;
        const hint = f.description ? f.description.slice(0, 160) : undefined;
        const wide = f.kind === 'text' && (f.multiple || (f.maxLength || 0) > 200);
        let control;
        if (f.kind === 'choice') {
          control = (
            <select id={id} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="">Choose…</option>
              {f.options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
            </select>
          );
        } else if (f.kind === 'boolean') {
          control = (
            <select id={id} value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(f.name, e.target.value === '' ? '' : e.target.value === 'true')} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
              <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          );
        } else if (f.kind === 'number') {
          control = <input id={id} type="number" value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />;
        } else if (f.kind === 'measure') {
          control = (
            <div className="flex gap-2">
              <input id={id} type="number" value={v?.value ?? ''} onChange={(e) => set(f.name, { ...(v || {}), value: e.target.value })} className="w-32 rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />
              <label className="sr-only" htmlFor={`${id}-unit`}>{f.title} unit</label>
              <select id={`${id}-unit`} value={v?.unit ?? ''} onChange={(e) => set(f.name, { ...(v || {}), unit: e.target.value })} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                <option value="">Unit…</option>
                {f.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          );
        } else if (wide) {
          control = (
            <textarea id={id} rows={f.multiple ? 5 : 4} maxLength={f.multiple ? undefined : (f.maxLength || undefined)}
              value={Array.isArray(v) ? v.join('\n') : (v ?? '')}
              onChange={(e) => set(f.name, f.multiple ? e.target.value.split('\n') : e.target.value)}
              className="w-full rounded-lg border p-2.5 text-sm" style={fieldStyle} />
          );
        } else {
          control = <input id={id} value={Array.isArray(v) ? v[0] ?? '' : (v ?? '')} maxLength={f.maxLength || undefined} onChange={(e) => set(f.name, e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle} />;
        }
        return (
          <div key={f.name} className={wide ? 'sm:col-span-2' : ''}>
            <Field label={label} htmlFor={id} hint={f.multiple && f.kind === 'text' ? `One per line.${hint ? ` ${hint}` : ''}` : hint}>{control}</Field>
          </div>
        );
      })}
      {fields.length === 0 && <p className="m-0 text-sm" style={{ color: COLORS.textSecondary }}>No fields.</p>}
    </div>
  );
};

export default SchemaForm;
