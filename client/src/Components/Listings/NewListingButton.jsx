import React, { useState } from 'react';
import { COLORS } from '../Shared/index.js';
import { useChangeRequest } from '../Actions/ChangeRequestModal.jsx';
import useActionCapabilities from '../../hooks/useActionCapabilities.js';
import NewListingDialog from './NewListingDialog.jsx';

/** "New listing" on Your Products; hidden until listing creation is switched on. */
const NewListingButton = ({ onCreated }) => {
  const { can } = useActionCapabilities();
  const { requestChange, changeModal } = useChangeRequest();
  const [open, setOpen] = useState(false);
  if (!can('listings.offer_existing_asin') && !can('listings.create_product')) return null;
  const review = async (actionType, input) => {
    setOpen(false);
    const outcome = await requestChange({ feature: 'listings', actionType, input });
    if (outcome?.status === 'succeeded') onCreated?.(outcome);
  };
  return (
    <>
      {changeModal}
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 px-[14px] py-[9px] rounded-lg text-[13px] font-medium border" style={{ borderColor: COLORS.border, background: COLORS.surface, color: COLORS.textPrimary }}>
        New listing
      </button>
      {open && <NewListingDialog onClose={() => setOpen(false)} onReview={review} />}
    </>
  );
};

export default NewListingButton;
