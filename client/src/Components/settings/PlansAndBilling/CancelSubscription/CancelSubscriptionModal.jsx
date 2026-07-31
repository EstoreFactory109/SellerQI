import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import ReasonSelector from './ReasonSelector';
import { CANCEL_REASONS } from './cancelReasons';
import FeedbackTextarea from './FeedbackTextarea';
import ProductUpdateCheckbox from './ProductUpdateCheckbox';
import SupportCard from './SupportCard';
import SuccessScreen from './SuccessScreen';
import PausedScreen from './PausedScreen';
import FooterActions from './FooterActions';

const FEEDBACK_PLACEHOLDERS = {
  'missing-features': 'Tell us which features were missing...',
  'found-another-solution': "Would you mind telling us which solution you're switching to?",
  other: 'Tell us more...',
};

/**
 * Multi-step subscription cancellation flow. Steps: 'reason' -> 'detail' -> 'success' | 'paused'.
 * "Hard to Use / Couldn't Set Up" is the only retention path and never reaches 'success' - it
 * always ends at 'paused' via the existing Book Demo Call widget + Support ticket submission,
 * the cancellation endpoint is never called for that reason.
 *
 * @param {boolean} isOpen
 * @param {Function} onClose
 * @param {Object} user - current user (Redux state.Auth.user)
 * @param {Function} onConfirmCancel - async (reason, feedback, wantsProductUpdates) => { success, message }
 * @param {Function} onRequestOnboardingHelp - async () => void, called after the user books a call
 * @param {Function} [onReturnToDashboard] - defaults to onClose
 */
export default function CancelSubscriptionModal({
  isOpen,
  onClose,
  user,
  onConfirmCancel,
  onRequestOnboardingHelp,
  onReturnToDashboard,
}) {
  const [step, setStep] = useState('reason');
  const [selectedReason, setSelectedReason] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [wantsProductUpdates, setWantsProductUpdates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bookingHelp, setBookingHelp] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !submitting && !bookingHelp) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, bookingHelp, onClose]);

  if (!isOpen) return null;

  const reasonLabel = CANCEL_REASONS.find((r) => r.value === selectedReason)?.label;

  const handleContinue = () => {
    if (!selectedReason) return;
    setErrorMessage('');
    setStep('detail');
  };

  const handleBack = () => {
    setErrorMessage('');
    setStep('reason');
  };

  const handleConfirmCancel = async () => {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const result = await onConfirmCancel(selectedReason, feedback, wantsProductUpdates);
      if (result?.success === false) {
        setErrorMessage(result?.message || 'Failed to cancel subscription. Please try again or contact support.');
        return;
      }
      setStep('success');
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || error?.message || 'Failed to cancel subscription. Please try again or contact support.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBookedCall = async () => {
    setBookingHelp(true);
    setErrorMessage('');
    try {
      await onRequestOnboardingHelp();
      setStep('paused');
    } catch (error) {
      console.error('Error requesting onboarding help:', error);
      setErrorMessage('Something went wrong. Please try again or contact support directly.');
    } finally {
      setBookingHelp(false);
    }
  };

  const handleReturn = () => {
    if (onReturnToDashboard) onReturnToDashboard();
    else onClose();
  };

  const renderDetailContent = () => {
    if (selectedReason === 'hard-to-use') {
      return <SupportCard user={user} onBookedCall={handleBookedCall} loading={bookingHelp} />;
    }

    const placeholder = FEEDBACK_PLACEHOLDERS[selectedReason];

    return (
      <div className="flex flex-col gap-4">
        {selectedReason === 'just-exploring' && (
          <ProductUpdateCheckbox checked={wantsProductUpdates} onChange={setWantsProductUpdates} />
        )}
        {placeholder && <FeedbackTextarea value={feedback} onChange={setFeedback} placeholder={placeholder} />}
        <FooterActions
          leftLabel="Back"
          onLeft={handleBack}
          rightLabel="Confirm Cancellation"
          onRight={handleConfirmCancel}
          rightLoading={submitting}
          rightVariant="destructive"
        />
      </div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={() => !submitting && !bookingHelp && onClose()}
        role="presentation"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-subscription-title"
          className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl w-full max-w-[820px] max-h-[90vh] overflow-y-auto p-6 md:p-8 relative"
        >
          {step !== 'success' && step !== 'paused' && (
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || bookingHelp}
              aria-label="Close"
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          <AnimatePresence mode="wait">
            {step === 'reason' && (
              <motion.div
                key="reason"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                <h3 id="cancel-subscription-title" className="text-xl font-bold text-gray-100 mb-1">
                  Cancel your subscription?
                </h3>
                <p className="text-sm text-gray-400 mb-5">
                  We&apos;d love to understand what made you decide to cancel.
                </p>
                <ReasonSelector selectedReason={selectedReason} onSelectReason={setSelectedReason} />
                <FooterActions
                  leftLabel="Keep My Account"
                  onLeft={onClose}
                  rightLabel="Continue"
                  onRight={handleContinue}
                  rightDisabled={!selectedReason}
                />
              </motion.div>
            )}

            {step === 'detail' && (
              <motion.div
                key="detail"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
              >
                <h3 id="cancel-subscription-title" className="sr-only">{reasonLabel}</h3>
                {renderDetailContent()}
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SuccessScreen onReturnToDashboard={handleReturn} />
              </motion.div>
            )}

            {step === 'paused' && (
              <motion.div key="paused" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <PausedScreen onClose={onClose} />
              </motion.div>
            )}
          </AnimatePresence>

          {errorMessage && (
            <p className="mt-4 text-sm text-red-400 text-center">{errorMessage}</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
