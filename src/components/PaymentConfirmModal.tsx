import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CreditCard, Loader2, X } from 'lucide-react';
import { formatRupees } from '../lib/orderService';

interface PaymentConfirmModalProps {
  open: boolean;
  orderCode: string;
  totalAmount: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PaymentConfirmModal: React.FC<PaymentConfirmModalProps> = ({
  open,
  orderCode,
  totalAmount,
  submitting,
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-confirm-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-md bg-white rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden"
          >
            <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h2
                    id="payment-confirm-modal-title"
                    className="font-display text-lg sm:text-xl font-extrabold text-neutral-900"
                  >
                    Have you completed the payment?
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Order <span className="font-mono font-bold text-[#E5391B]">#{orderCode}</span> ·{' '}
                    <span className="font-mono font-bold text-neutral-900">
                      {formatRupees(totalAmount)}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={onCancel}
                aria-label="Close confirmation dialog"
                className="w-8 h-8 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 flex items-center justify-center cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              <p className="text-sm text-neutral-600 leading-relaxed">
                This will notify RikZen Fast Food to manually check and verify your UPI payment.
                Your bill will update to <span className="font-bold text-emerald-700">PAID</span>{' '}
                automatically once confirmed by the restaurant.
              </p>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onCancel}
                  className="sm:w-2/5 min-h-[48px] px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-800 font-bold text-sm cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onConfirm}
                  className="sm:flex-1 min-h-[48px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-sm active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {submitting ? 'Sending Request...' : 'Yes, I Paid'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
