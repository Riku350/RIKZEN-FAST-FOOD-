import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { motion } from 'motion/react';
import { CheckCircle2, Heart, RotateCcw, UtensilsCrossed } from 'lucide-react';
import { formatRupees } from '../lib/orderService';

interface ThankYouScreenProps {
  tableNumber: number;
  orderNumber: number;
  total: number;
  onStartNewOrder: () => void;
}

export const ThankYouScreen: React.FC<ThankYouScreenProps> = ({
  tableNumber,
  orderNumber,
  total,
  onStartNewOrder,
}) => {
  const [showFollowUp, setShowFollowUp] = useState(false);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReduced) {
      confetti({
        particleCount: 70,
        spread: 68,
        origin: { y: 0.58 },
        colors: ['#E5391B', '#F97316', '#16A34A', '#FACC15'],
        disableForReducedMotion: true,
      });
    }

    const timer = window.setTimeout(() => {
      setShowFollowUp(true);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-[78vh] flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-w-lg w-full bg-white rounded-3xl border border-neutral-200 p-8 sm:p-10 text-center overflow-hidden"
      >
        {/* Subtle floating celebration accents */}
        <motion.div
          animate={{ y: [-4, 4, -4] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-6 left-7 text-[#E5391B]/25 pointer-events-none"
          aria-hidden="true"
        >
          <UtensilsCrossed className="w-6 h-6" />
        </motion.div>
        <motion.div
          animate={{ y: [4, -4, 4], scale: [1, 1.08, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-7 right-8 text-[#E5391B]/30 pointer-events-none"
          aria-hidden="true"
        >
          <Heart className="w-6 h-6 fill-current" />
        </motion.div>

        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 20 }}
          className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-5"
        >
          <CheckCircle2 className="w-9 h-9" />
        </motion.div>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-900 mb-3">
          Thank You!
        </h1>

        <p className="text-lg font-semibold text-neutral-800 mb-3 flex items-center justify-center gap-1.5">
          <span>Thank you for visiting RikZen Fast Food</span>
          <motion.span
            animate={{ scale: [1, 1.18, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="inline-flex text-[#E5391B]"
          >
            <Heart className="w-5 h-5 fill-current" />
          </motion.span>
        </p>

        <p className="text-sm text-neutral-600 leading-relaxed max-w-sm mx-auto mb-2">
          We&apos;re happy to serve you.
        </p>
        <p className="text-sm text-neutral-500 leading-relaxed max-w-sm mx-auto mb-6">
          Thank you for giving us the opportunity to serve you.
        </p>

        <div className="flex items-center justify-center gap-3 text-xs font-medium text-neutral-500 py-3 border-y border-neutral-100 mb-6 tabular-nums">
          <span>Table {tableNumber}</span>
          <span aria-hidden="true">·</span>
          <span>Order #{orderNumber}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-neutral-900">{formatRupees(total)}</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: showFollowUp ? 1 : 0, y: showFollowUp ? 0 : 6 }}
          transition={{ duration: 0.4 }}
          className="min-h-[28px] mb-6"
        >
          <p className="text-base font-bold text-[#E5391B]">We hope to see you again!</p>
        </motion.div>

        <button
          type="button"
          onClick={onStartNewOrder}
          className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
        >
          <RotateCcw className="w-4 h-4" />
          Order Again at Table {tableNumber}
        </button>
      </motion.div>
    </div>
  );
};
