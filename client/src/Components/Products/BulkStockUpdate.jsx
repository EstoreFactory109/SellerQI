import React, { useState } from 'react';
import { COLORS } from '../Shared/index.js';
import { useChangeRequest } from '../Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';

/** "SKU, quantity" lines (comma, tab or semicolon), a header row allowed. Exported for tests. */
export function parseStockLines(text) {
  const items = [];
  const bad = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [sku, qty] = trimmed.split(/[,\t;]/).map((x) => (x || '').trim().replace(/^"|"$/g, ''));
    if (i === 0 && /sku/i.test(sku) && !/^\d+$/.test(qty || '')) return; // header
    if (!sku || qty === undefined || !/^\d+$/.test(qty)) { bad.push(i + 1); return; }
    items.push({ sku, quantity: Number(qty) });
  });
  return { items, bad };
}

/**
 * Stock for many FBM SKUs in one update (an Amazon feed). Nothing is sent from
 * here: the approval window shows every SKU's current and new stock first.
 */
const BulkStockUpdate = ({ onSent }) => {
  const { can } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (!can('feeds.bulk_fbm_stock')) return null;

  const loadFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  };
  const review = async () => {
    const { items, bad } = parseStockLines(text);
    if (bad.length) return setError(`Line${bad.length === 1 ? '' : 's'} ${bad.slice(0, 5).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not "SKU, quantity".`);
    if (items.length === 0) return setError('Add at least one line: SKU, quantity.');
    setOpen(false);
    setError('');
    const outcome = await requestChange({ feature: 'feeds', actionType: 'feeds.bulk_fbm_stock', input: { items }, source: 'bulk' });
    if (outcome?.status && outcome.status !== 'closed') { setText(''); onSent?.(outcome); }
    return outcome;
  };

  return (
    <>
      {changeModal}
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 px-[14px] py-[9px] rounded-lg text-[13px] font-medium border" style={{ borderColor: COLORS.border, background: COLORS.surface, color: COLORS.textPrimary }}>
        Bulk FBM stock
      </button>
      {open && (
        <Dialog title="Update stock for many SKUs" subtitle="Only SKUs you ship yourself (FBM). One line per SKU: SKU, quantity." onClose={() => setOpen(false)} labelId="bulk-stock-title" wide
          footer={<><SecondaryButton onClick={() => setOpen(false)}>Cancel</SecondaryButton><PrimaryButton onClick={review}>Review</PrimaryButton></>}>
          <div className="flex flex-col gap-3">
            <Field label="SKU, quantity" htmlFor="bulk-stock-text" hint="Paste from a spreadsheet, or choose a CSV file.">
              <textarea id="bulk-stock-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SKU-1, 12\nSKU-2, 0'} className="w-full rounded-lg border p-2.5 text-sm font-mono" style={fieldStyle} />
            </Field>
            <Field label="Or a CSV file" htmlFor="bulk-stock-file">
              <input id="bulk-stock-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={loadFile} className="text-sm" style={{ color: COLORS.textSecondary }} />
            </Field>
          </div>
          {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
        </Dialog>
      )}
    </>
  );
};

export default BulkStockUpdate;
