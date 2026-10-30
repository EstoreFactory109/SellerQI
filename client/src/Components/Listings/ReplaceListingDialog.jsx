import React, { useEffect, useMemo, useState } from 'react';
import { COLORS } from '../Shared/index.js';
import axiosInstance from '../../config/axios.config.js';
import Dialog, { Field, PrimaryButton, SecondaryButton, fieldStyle } from '../Actions/Dialog.jsx';
import SchemaForm from './SchemaForm.jsx';

/**
 * Replace a listing's content: the fields as Amazon has them now, editable. Only
 * edited fields change; everything else is sent back as it is (a full replace
 * would otherwise remove it). The approval window shows each changed field.
 */
const ReplaceListingDialog = ({ sku, onClose, onReview }) => {
  const [def, setDef] = useState(null);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [extra, setExtra] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    axiosInstance.get('/api/actions/listings/fields', { params: { sku } })
      .then((res) => { const d = res.data?.data; setDef(d); setValues(d?.values || {}); setOriginal(d?.values || {}); })
      .catch((err) => setError(err.response?.data?.message || 'Could not read this listing from Amazon.'));
  }, [sku]);

  const shown = useMemo(() => (def?.fields || []).filter((f) => f.required || original[f.name] !== undefined || extra.includes(f.name)), [def, original, extra]);
  const optional = useMemo(() => (def?.fields || []).filter((f) => !f.required && original[f.name] === undefined && !extra.includes(f.name)), [def, original, extra]);

  const review = () => {
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(original[k])));
    if (!Object.keys(changed).length) return setError('Change at least one field.');
    return onReview({ sku, values: changed });
  };

  return (
    <Dialog title={`Replace listing ${sku}`} subtitle={def ? `${def.displayName}. Only the fields you change are changed.` : 'Reading the listing from Amazon…'} onClose={onClose} wide labelId="replace-listing-title"
      footer={<><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton onClick={review} disabled={!def}>Review</PrimaryButton></>}>
      {def && (
        <div className="flex flex-col gap-4">
          <SchemaForm fields={shown} values={values} onChange={setValues} idPrefix="rl-f" />
          {optional.length > 0 && (
            <Field label="Add a field" htmlFor="rl-more">
              <select id="rl-more" value="" onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])} className="rounded-lg border px-2.5 py-2 text-sm" style={fieldStyle}>
                <option value="">Choose a field…</option>
                {optional.map((f) => <option key={f.name} value={f.name}>{f.title}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 mt-3 text-sm" style={{ color: COLORS.fix }}>{error}</p>}
    </Dialog>
  );
};

export default ReplaceListingDialog;
