import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  PackageSearch,
  Phone,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Utensils,
} from 'lucide-react';
import {
  formatIndianMobileInput,
  formatOrderDate,
  formatRupees,
  getSavedCustomerDetails,
  lookupCustomerOrdersByMobile,
  normalizeIndianPhoneDigits,
} from '../lib/orderService';
import { OrderStatus, PaymentStatus, RecoverableOrderSummary } from '../types/restaurant';
import { AmbientFoodBackdrop } from './AmbientFoodBackdrop';
import { FoodArtIcon } from './FoodArtIcons';

interface FindOrderPageProps {
  onNavigate: (path: string) => void;
}

type LookupPhase = 'idle' | 'searching' | 'found_single' | 'found_multiple' | 'not_found';

function getOrderStatusBadge(status: OrderStatus): {
  label: string;
  classes: string;
} {
  switch (status) {
    case 'pending':
      return {
        label: 'Waiting Confirmation',
        classes: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'accepted':
    case 'confirmed':
      return {
        label: 'Confirmed',
        classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'preparing':
      return {
        label: 'Being Prepared',
        classes: 'bg-orange-50 text-orange-800 border-orange-200',
      };
    case 'ready':
      return {
        label: 'Order Ready',
        classes: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      };
    case 'bill_requested':
      return {
        label: 'Bill Requested',
        classes: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    case 'bill_ready':
      return {
        label: 'Bill Ready',
        classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'completed':
      return {
        label: 'Completed',
        classes: 'bg-neutral-100 text-neutral-800 border-neutral-200',
      };
    case 'cancelled':
    case 'rejected':
      return {
        label: 'Cancelled',
        classes: 'bg-red-50 text-red-700 border-red-200',
      };
    default:
      return {
        label: 'Active',
        classes: 'bg-neutral-100 text-neutral-700 border-neutral-200',
      };
  }
}

function getPaymentBadge(paymentStatus: PaymentStatus): {
  label: string;
  classes: string;
} {
  switch (paymentStatus) {
    case 'paid':
      return {
        label: 'Paid',
        classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'verification_requested':
      return {
        label: 'Verifying Payment',
        classes: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'not_received':
    case 'failed':
      return {
        label: 'Payment Not Received',
        classes: 'bg-red-50 text-red-700 border-red-200',
      };
    default:
      return {
        label: 'Payment Pending',
        classes: 'bg-neutral-100 text-neutral-600 border-neutral-200',
      };
  }
}

export const FindOrderPage: React.FC<FindOrderPageProps> = ({ onNavigate }) => {
  const prefersReducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

  const [mobileInput, setMobileInput] = useState<string>(() => {
    const saved = getSavedCustomerDetails();
    return saved.mobileDigits ? formatIndianMobileInput(saved.mobileDigits) : '';
  });
  const [phase, setPhase] = useState<LookupPhase>('idle');
  const [foundOrders, setFoundOrders] = useState<RecoverableOrderSummary[]>([]);
  const [matchedSingleCode, setMatchedSingleCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      onNavigate('/');
    }
  };

  const handleMobileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMobileInput(formatIndianMobileInput(e.target.value));
    if (errorMessage) setErrorMessage(null);
    if (phase === 'not_found') setPhase('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === 'searching' || phase === 'found_single') return;

    const normalized = normalizeIndianPhoneDigits(mobileInput);
    if (!normalized) {
      setErrorMessage(
        'Please enter a valid 10-digit Indian mobile number (for example: 62994 75970).',
      );
      inputRef.current?.focus();
      return;
    }

    setErrorMessage(null);
    setPhase('searching');

    const startedAt = Date.now();
    try {
      const result = await lookupCustomerOrdersByMobile(normalized);
      const elapsed = Date.now() - startedAt;
      const minWait = prefersReducedMotion ? 0 : Math.max(0, 360 - elapsed);
      if (minWait > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, minWait));
      }

      if (!result.found || result.orders.length === 0) {
        setFoundOrders([]);
        setPhase('not_found');
        return;
      }

      setFoundOrders(result.orders);

      if (result.orders.length === 1) {
        const singleOrder = result.orders[0];
        setMatchedSingleCode(singleOrder.order_code);
        setPhase('found_single');
        const delayMs = prefersReducedMotion ? 120 : 580;
        redirectTimerRef.current = window.setTimeout(() => {
          onNavigate(`/order/${encodeURIComponent(singleOrder.token)}`);
        }, delayMs);
      } else {
        setPhase('found_multiple');
      }
    } catch (err) {
      setPhase('idle');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to find your order right now. Please try again.',
      );
    }
  };

  const handleTryAgain = () => {
    setPhase('idle');
    setFoundOrders([]);
    setErrorMessage(null);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  };

  const digitCount = mobileInput.replace(/\D/g, '').length;

  return (
    <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
      <AmbientFoodBackdrop />

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-3xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            BACK
          </button>

          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-neutral-900 whitespace-nowrap cursor-pointer"
          >
            RikZen <span className="text-[#E5391B]">Fast Food</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('/menu?table=1')}
            className="hidden sm:inline-flex min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Utensils className="w-3.5 h-3.5 text-[#E5391B]" />
            Menu
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {/* ========================================================== */}
          {/* STATE: IDLE / SEARCHING / FOUND SINGLE                     */}
          {/* ========================================================== */}
          {(phase === 'idle' || phase === 'searching' || phase === 'found_single') && (
            <motion.section
              key="lookup-form-card"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden"
            >
              {/* Brand Accent Header */}
              <div className="bg-[#151110] text-white px-6 py-6 sm:px-8 sm:py-7 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-extrabold uppercase tracking-wider">
                    <PackageSearch className="w-4 h-4" />
                    Order Recovery · No Login Needed
                  </div>
                  <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                    Find Your Order
                  </h1>
                  <p className="text-xs sm:text-sm text-neutral-300">
                    Enter the mobile number used for your order
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                  <FoodArtIcon kind="burger" className="w-8 h-8" />
                </div>
              </div>

              <div className="p-6 sm:p-8 space-y-6">
                {phase === 'searching' ? (
                  <div className="py-10 text-center space-y-4">
                    <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                      <span className="absolute inset-0 rounded-2xl bg-[#E5391B]/15 animate-ping" />
                      <div className="relative w-16 h-16 rounded-2xl bg-[#FEF2F0] border border-[#E5391B]/25 text-[#E5391B] flex items-center justify-center">
                        <Loader2 className="w-7 h-7 animate-spin" />
                      </div>
                    </div>
                    <div>
                      <p className="text-lg font-extrabold text-neutral-900">
                        Finding your order...
                      </p>
                      <p className="text-xs sm:text-sm text-neutral-500 mt-1">
                        Checking active and recent orders for{' '}
                        <span className="font-mono font-bold text-neutral-800">
                          +91 {mobileInput}
                        </span>
                      </p>
                    </div>
                  </div>
                ) : phase === 'found_single' ? (
                  <motion.div
                    initial={prefersReducedMotion ? false : { scale: 0.94, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="py-10 text-center space-y-3"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <p className="text-xl font-extrabold text-emerald-900">Order Found!</p>
                    <p className="text-sm text-neutral-600">
                      Opening live status for{' '}
                      <span className="font-mono font-bold text-[#E5391B]">
                        #{matchedSingleCode}
                      </span>
                      ...
                    </p>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                    <div className="space-y-2">
                      <label
                        htmlFor="find-order-mobile"
                        className="block text-xs font-extrabold uppercase tracking-wider text-neutral-600"
                      >
                        Mobile Number
                      </label>
                      <div className="flex items-stretch rounded-2xl border-2 border-neutral-200 focus-within:border-[#E5391B] bg-neutral-50 focus-within:bg-white transition-colors overflow-hidden">
                        <span className="px-4 flex items-center gap-1.5 bg-neutral-100 border-r border-neutral-200 font-mono text-base sm:text-lg font-extrabold text-neutral-800 select-none shrink-0">
                          <Phone className="w-4 h-4 text-[#E5391B]" />
                          +91
                        </span>
                        <input
                          ref={inputRef}
                          id="find-order-mobile"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          placeholder="XXXXX XXXXX"
                          value={mobileInput}
                          onChange={handleMobileChange}
                          className="w-full min-h-[56px] px-4 py-3 bg-transparent font-mono text-lg sm:text-xl font-bold tracking-wider text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                          aria-describedby="find-order-hint"
                        />
                      </div>
                      <div
                        id="find-order-hint"
                        className="flex items-center justify-between text-xs text-neutral-500 px-1"
                      >
                        <span>Works with 10-digit number or +91 format</span>
                        <span className="font-mono font-semibold tabular-nums">
                          {digitCount}/10
                        </span>
                      </div>
                    </div>

                    {errorMessage && (
                      <div
                        role="alert"
                        className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs sm:text-sm font-semibold text-red-800 flex items-start gap-2.5"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-[#E5391B] text-white font-extrabold text-base tracking-wide hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2.5 cursor-pointer shadow-sm"
                    >
                      <Search className="w-5 h-5" />
                      FIND ORDER
                    </button>

                    <div className="pt-2 border-t border-neutral-100 flex items-start gap-2.5 text-xs text-neutral-500">
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        Shows only active and recent orders linked to your mobile number. No
                        password or sign-in required.
                      </p>
                    </div>
                  </form>
                )}
              </div>
            </motion.section>
          )}

          {/* ========================================================== */}
          {/* STATE: MULTIPLE RECENT ORDERS                              */}
          {/* ========================================================== */}
          {phase === 'found_multiple' && (
            <motion.section
              key="multiple-orders"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700 mb-1">
                      <CheckCircle2 className="w-4 h-4" />
                      {foundOrders.length} Orders Found
                    </div>
                    <h1 className="font-display text-2xl font-extrabold text-neutral-900">
                      Your Recent Orders
                    </h1>
                    <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
                      For mobile <span className="font-mono font-bold text-neutral-800">+91 {mobileInput}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTryAgain}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-700 hover:bg-neutral-50 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Change Number
                  </button>
                </div>

                <div className="space-y-3">
                  {foundOrders.map((order) => {
                    const statusBadge = getOrderStatusBadge(order.status);
                    const payBadge = getPaymentBadge(order.payment_status);
                    const { date, time } = formatOrderDate(order.created_at_iso);

                    return (
                      <div
                        key={order.token}
                        className="rounded-2xl border border-neutral-200 bg-neutral-50/70 hover:bg-white hover:border-[#E5391B]/40 transition-all p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-base font-extrabold text-[#E5391B]">
                                #{order.order_code}
                              </span>
                              <span className="text-xs font-bold text-neutral-600">
                                · Table {order.table_number}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-500 mt-1 inline-flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {date} · {time}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="font-mono text-lg font-extrabold text-neutral-900 tabular-nums">
                              {formatRupees(order.total)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-200/70">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold ${statusBadge.classes}`}
                            >
                              {statusBadge.label}
                            </span>
                            <span
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${payBadge.classes}`}
                            >
                              {payBadge.label}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => onNavigate(`/order/${encodeURIComponent(order.token)}`)}
                            className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-900 hover:bg-[#E5391B] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            VIEW ORDER
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          )}

          {/* ========================================================== */}
          {/* STATE: NOT FOUND                                           */}
          {/* ========================================================== */}
          {phase === 'not_found' && (
            <motion.section
              key="order-not-found"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 text-center space-y-5 shadow-sm"
            >
              <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
                <Receipt className="w-8 h-8" />
              </div>

              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-extrabold text-neutral-900">
                  Order Not Found
                </h1>
                <p className="text-sm text-neutral-600 max-w-sm mx-auto leading-relaxed">
                  We couldn&apos;t find a recent order with this mobile number.
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-left space-y-2 max-w-sm mx-auto">
                <p className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                  Please check:
                </p>
                <ul className="text-xs sm:text-sm text-neutral-700 space-y-1.5 list-disc list-inside">
                  <li>Mobile number matches the one entered at checkout</li>
                  <li>Country code (+91) and 10-digit format</li>
                  <li>Order was placed recently at RikZen Fast Food</li>
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTryAgain}
                  className="flex-1 min-h-[50px] px-5 py-3 rounded-2xl bg-[#E5391B] text-white font-extrabold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  TRY AGAIN
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/')}
                  className="sm:w-auto min-h-[50px] px-5 py-3 rounded-2xl border border-neutral-200 text-neutral-800 font-bold text-sm hover:bg-neutral-50 transition-colors cursor-pointer"
                >
                  Back to Home
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
