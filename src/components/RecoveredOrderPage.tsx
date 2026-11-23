import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  Loader2,
  Phone,
  QrCode,
  Receipt,
  Search,
  Share2,
  Smartphone,
  Utensils,
  XCircle,
} from 'lucide-react';
import { getPublicBillUrl, shareBillNative } from '../lib/billShare';
import {
  customerRequestPaymentVerification,
  downloadOrderBillPdf,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRupees,
  isCancelledOrderStatus,
  requestOrderBill,
  resolveRecoveryToken,
  subscribeToOrder,
  subscribeToPaymentSettings,
  toCustomerFriendlyError,
} from '../lib/orderService';
import { downloadPaymentQrPng } from '../lib/paymentQrDownload';
import { buildDynamicUpiUri, DEFAULT_PAYMENT_SETTINGS } from '../lib/upiPayment';
import {
  speakCustomerOrderCancelled,
  unlockCustomerAudioOnGesture,
} from '../lib/voiceOrderAlert';
import {
  OrderRecord,
  OrderStatus,
  PaymentSettings,
  RecoveredOrderTokenPayload,
} from '../types/restaurant';
import { AmbientFoodBackdrop } from './AmbientFoodBackdrop';
import { BillPreviewModal } from './BillPreviewModal';
import { FoodArtIcon } from './FoodArtIcons';

interface RecoveredOrderPageProps {
  token: string;
  onNavigate: (path: string) => void;
}

const PROGRESS_STEPS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Completed' },
];

function getProgressStepIndex(status: OrderStatus): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'accepted':
    case 'confirmed':
      return 1;
    case 'preparing':
      return 2;
    case 'ready':
    case 'bill_requested':
    case 'bill_ready':
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

function getStatusHeroConfig(status: OrderStatus): {
  badge: string;
  welcomeSubtext: string;
  description: string;
  tone: 'amber' | 'orange' | 'emerald' | 'red';
} {
  switch (status) {
    case 'pending':
      return {
        badge: 'WAITING FOR CONFIRMATION',
        welcomeSubtext: 'Waiting for restaurant confirmation.',
        description:
          'Your order has been sent to the RikZen kitchen. Status will update automatically as soon as the restaurant confirms.',
        tone: 'amber',
      };
    case 'accepted':
    case 'confirmed':
      return {
        badge: 'ORDER CONFIRMED',
        welcomeSubtext: 'Your order has been confirmed.',
        description:
          'The RikZen kitchen has accepted your order and will start preparing your dishes shortly.',
        tone: 'emerald',
      };
    case 'preparing':
      return {
        badge: 'BEING PREPARED',
        welcomeSubtext: 'Your order is being prepared.',
        description:
          'Our chefs are freshly cooking your food right now. Stay seated — it will be served to your table soon.',
        tone: 'orange',
      };
    case 'ready':
      return {
        badge: 'ORDER READY',
        welcomeSubtext: 'Your order is ready!',
        description: 'Your freshly prepared order is ready and being served to your table.',
        tone: 'emerald',
      };
    case 'bill_requested':
      return {
        badge: 'BILL REQUESTED',
        welcomeSubtext: 'Your bill request has been sent.',
        description:
          'You can view, download, or pay your bill right here while our staff assists you.',
        tone: 'amber',
      };
    case 'bill_ready':
      return {
        badge: 'BILL READY',
        welcomeSubtext: 'Your bill is ready.',
        description:
          'View, download, or share your verified RikZen Fast Food bill and pay securely via UPI QR.',
        tone: 'emerald',
      };
    case 'completed':
      return {
        badge: 'COMPLETED',
        welcomeSubtext: 'Your order is completed. Thank you for visiting!',
        description:
          'Thank you for dining at RikZen Fast Food. Your digital bill remains available to download or share.',
        tone: 'emerald',
      };
    case 'cancelled':
    case 'rejected':
      return {
        badge: 'ORDER CANCELLED',
        welcomeSubtext: 'Your order has been cancelled.',
        description:
          'Sorry, this order was cancelled by the restaurant. Please speak with our counter staff if you need any assistance.',
        tone: 'red',
      };
    default:
      return {
        badge: 'ORDER ACTIVE',
        welcomeSubtext: 'Tracking your live order status.',
        description: 'Your order status updates automatically in real time.',
        tone: 'emerald',
      };
  }
}

export const RecoveredOrderPage: React.FC<RecoveredOrderPageProps> = ({ token, onNavigate }) => {
  const prefersReducedMotion = useReducedMotion();
  const [resolvedMeta, setResolvedMeta] = useState<RecoveredOrderTokenPayload | null>(null);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [billModalOpen, setBillModalOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [requestingBill, setRequestingBill] = useState(false);
  const [requestingPaymentVerify, setRequestingPaymentVerify] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const prevStatusRef = useRef<OrderStatus | null>(null);

  // Unlock audio on first user interaction for cancellation voice alert
  useEffect(() => {
    const unlock = () => {
      void unlockCustomerAudioOnGesture();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Live payment settings subscription
  useEffect(() => {
    const unsub = subscribeToPaymentSettings((settings) => {
      setPaymentSettings(settings);
    });
    return () => unsub();
  }, []);

  // Redeem opaque token and subscribe live to the recovered order in Firestore
  useEffect(() => {
    let active = true;
    let unsubOrder: (() => void) | null = null;

    setLoading(true);
    setError(null);
    setOrder(null);
    setResolvedMeta(null);
    prevStatusRef.current = null;

    resolveRecoveryToken(token)
      .then((payload) => {
        if (!active) return;
        setResolvedMeta(payload);
        unsubOrder = subscribeToOrder(
          payload.order_id,
          (liveOrder) => {
            if (!active) return;
            if (!liveOrder) {
              setError('This order record is no longer available.');
              setLoading(false);
              return;
            }
            setOrder(liveOrder);
            setLoading(false);
            setError(null);
          },
          (err) => {
            if (!active) return;
            setError(toCustomerFriendlyError(err));
            setLoading(false);
          },
        );
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'This order link is invalid or has expired. Please use Find My Order again.',
        );
        setLoading(false);
      });

    return () => {
      active = false;
      if (unsubOrder) unsubOrder();
    };
  }, [token]);

  // Announce cancellation once if order becomes cancelled while viewing
  useEffect(() => {
    if (!order) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = order.status;
    if (isCancelledOrderStatus(order.status) && prev !== null && !isCancelledOrderStatus(prev)) {
      void speakCustomerOrderCancelled(order.id);
    }
  }, [order?.id, order?.status]);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    window.setTimeout(() => {
      setActionFeedback((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      onNavigate('/find-order');
    }
  };

  const firstName = useMemo(() => {
    const raw = (order?.customer_name || resolvedMeta?.customer_name || 'Guest').trim();
    return raw.split(/\s+/)[0] || 'Guest';
  }, [order?.customer_name, resolvedMeta?.customer_name]);

  if (loading) {
    return (
      <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
        <AmbientFoodBackdrop />
        <main className="relative z-10 flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-neutral-200 p-8 sm:p-10 max-w-md w-full text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-[#FEF2F0] text-[#E5391B] flex items-center justify-center mx-auto">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-neutral-900">Loading your order...</h1>
              <p className="text-xs sm:text-sm text-neutral-500 mt-1">
                Connecting to RikZen Fast Food for live kitchen &amp; payment updates.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
        <AmbientFoodBackdrop />
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200">
          <div className="max-w-3xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleBack}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              BACK
            </button>
            <span className="font-display text-lg font-extrabold text-neutral-900">
              RikZen <span className="text-[#E5391B]">Fast Food</span>
            </span>
            <span className="w-16" />
          </div>
        </header>

        <main className="relative z-10 flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-neutral-200 p-8 max-w-md w-full text-center space-y-5 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-xl font-extrabold text-neutral-900">
                Order Link Unavailable
              </h1>
              <p className="text-sm text-neutral-600 leading-relaxed">
                {error || 'This temporary order link is invalid or has expired.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('/find-order')}
                className="flex-1 min-h-[48px] px-5 py-3 rounded-2xl bg-[#E5391B] text-white font-extrabold text-sm hover:bg-[#C82E14] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                Find My Order
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/')}
                className="min-h-[48px] px-5 py-3 rounded-2xl border border-neutral-200 text-neutral-800 font-bold text-sm hover:bg-neutral-50 cursor-pointer"
              >
                Home
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const orderCode = (order.order_code || `RK${order.order_number}`).toUpperCase();
  const { date, time } = formatOrderDate(order.created_at);
  const statusHero = getStatusHeroConfig(order.status);
  const isCancelled = isCancelledOrderStatus(order.status);
  const isPending = order.status === 'pending';
  const isCompleted = order.status === 'completed';
  const isConfirmedOrFurther = !isPending && !isCancelled;
  const canRequestBill = ['accepted', 'confirmed', 'preparing', 'ready'].includes(order.status);

  const paymentStatus = order.payment_status || 'pending';
  const isPaid = paymentStatus === 'paid';
  const isVerificationPending = paymentStatus === 'verification_requested';
  const isNotReceived = paymentStatus === 'not_received' || paymentStatus === 'failed';

  // Use immutable payment_qr_snapshot first, then live payment settings
  const snapshot = order.payment_qr_snapshot || null;
  const activeMode = snapshot?.mode || paymentSettings.payment_mode || 'dynamic_upi';
  const activeMerchantName =
    snapshot?.merchant_name || paymentSettings.merchant_name || 'RikZen Fast Food';
  const activeQrImageUrl = snapshot?.qr_image_url || paymentSettings.qr_image_url || '';
  const activeUpiId = snapshot?.upi_id || paymentSettings.upi_id || '';
  const dynamicUpiUri =
    activeMode === 'dynamic_upi'
      ? snapshot?.upi_uri ||
        buildDynamicUpiUri({
          upiId: activeUpiId,
          merchantName: activeMerchantName,
          amount: order.total,
          orderCode,
          tableNumber: order.table_number,
        }) ||
        order.upi_uri ||
        ''
      : '';

  const showUploadedQr = activeMode === 'uploaded_qr' && Boolean(activeQrImageUrl);
  const showDynamicUpiQr = activeMode === 'dynamic_upi' && Boolean(dynamicUpiUri);
  const activePublicBillId = order.public_bill_id || order.id;
  const publicBillUrl = activePublicBillId ? getPublicBillUrl(activePublicBillId) : '';
  const currentStepIdx = getProgressStepIndex(order.status);

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      await downloadOrderBillPdf(order);
      showToast('Bill PDF downloaded.');
    } catch (err) {
      setActionError(toCustomerFriendlyError(err));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleShareBill = async () => {
    setActionError(null);
    const outcome = await shareBillNative({
      order_code: orderCode,
      table_number: order.table_number,
      customer_name: order.customer_name,
      total: order.total,
      public_bill_id: activePublicBillId,
      pdf_url: order.pdf_url,
    });
    if (outcome.method !== 'cancelled') {
      showToast(outcome.message);
    }
  };

  const handleDownloadQr = async () => {
    if (downloadingQr) return;
    setDownloadingQr(true);
    setActionError(null);
    try {
      await downloadPaymentQrPng({
        mode: showUploadedQr ? 'uploaded_qr' : 'dynamic_upi',
        upiUri: dynamicUpiUri,
        qrImageUrl: activeQrImageUrl,
        merchantName: activeMerchantName,
        upiId: activeUpiId,
        amount: order.total,
        orderCode,
        tableNumber: order.table_number,
      });
      showToast('Payment QR downloaded.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to download Payment QR right now.',
      );
    } finally {
      setDownloadingQr(false);
    }
  };

  const handleRequestBill = async () => {
    if (requestingBill || !canRequestBill) return;
    setRequestingBill(true);
    setActionError(null);
    try {
      await requestOrderBill(order.id);
      showToast('Bill requested. Our staff has been notified.');
    } catch (err) {
      setActionError(toCustomerFriendlyError(err));
    } finally {
      setRequestingBill(false);
    }
  };

  const handleIHavePaid = async () => {
    if (requestingPaymentVerify || isPaid || isVerificationPending || isCancelled) return;
    setRequestingPaymentVerify(true);
    setActionError(null);
    try {
      await customerRequestPaymentVerification(order.id);
      showToast('Payment verification requested. Waiting for owner confirmation.');
    } catch (err) {
      setActionError(toCustomerFriendlyError(err));
    } finally {
      setRequestingPaymentVerify(false);
    }
  };

  const heroToneClasses =
    statusHero.tone === 'red'
      ? 'bg-red-50 border-red-200 text-red-900'
      : statusHero.tone === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-950'
        : statusHero.tone === 'orange'
          ? 'bg-orange-50 border-orange-200 text-orange-950'
          : 'bg-emerald-50 border-emerald-200 text-emerald-950';

  const heroBadgeClasses =
    statusHero.tone === 'red'
      ? 'bg-red-700 text-white'
      : statusHero.tone === 'amber'
        ? 'bg-amber-600 text-white'
        : statusHero.tone === 'orange'
          ? 'bg-orange-600 text-white'
          : 'bg-emerald-700 text-white';

  return (
    <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
      <AmbientFoodBackdrop />

      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-3xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            BACK
          </button>

          <div className="text-center min-w-0">
            <p className="font-display text-sm sm:text-base font-extrabold text-neutral-900 truncate">
              RikZen <span className="text-[#E5391B]">Fast Food</span>
            </p>
            <p className="font-mono text-[11px] font-bold text-neutral-500 truncate">
              Order #{orderCode} · Table {order.table_number}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/find-order')}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-[#E5391B]" />
            <span className="hidden sm:inline">Find Another</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {/* Welcome Back Greeting Banner */}
        <motion.section
          initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="bg-[#151110] text-white rounded-3xl p-5 sm:p-6 flex items-center justify-between gap-4 shadow-sm"
        >
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Order Updates Active
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-amber-100/90 font-medium">{statusHero.welcomeSubtext}</p>
          </div>
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
            <FoodArtIcon kind="burger" className="w-8 h-8 sm:w-9 sm:h-9" />
          </div>
        </motion.section>

        {/* Action Toast & Error Feedback */}
        {actionFeedback && (
          <div
            role="status"
            className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs sm:text-sm font-bold text-emerald-900 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionFeedback}</span>
          </div>
        )}
        {actionError && (
          <div
            role="alert"
            className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs sm:text-sm font-bold text-red-800 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Real-Time Status Hero Card */}
        <motion.section
          key={order.status}
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className={`rounded-3xl border p-5 sm:p-6 space-y-4 ${heroToneClasses}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold tracking-wider inline-flex items-center gap-1.5 ${heroBadgeClasses}`}
              >
                {isCancelled ? (
                  <XCircle className="w-4 h-4" />
                ) : order.status === 'preparing' ? (
                  <ChefHat className="w-4 h-4" />
                ) : isPending ? (
                  <Clock className="w-4 h-4" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {statusHero.badge}
              </span>
            </div>
            <span className="font-mono text-xs font-bold opacity-80">
              Table {order.table_number} · #{orderCode}
            </span>
          </div>

          <p className="text-sm font-medium leading-relaxed opacity-90">{statusHero.description}</p>

          {/* Clean Stepper for Active/Completed Orders */}
          {!isCancelled && (
            <div className="pt-2">
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {PROGRESS_STEPS.map((step, idx) => {
                  const reached = idx <= currentStepIdx;
                  const isCurrent = idx === currentStepIdx;
                  return (
                    <div key={step.key} className="space-y-1.5">
                      <div
                        className={`h-2 rounded-full transition-colors ${
                          reached
                            ? isCurrent && !isCompleted
                              ? 'bg-[#E5391B] animate-pulse'
                              : 'bg-emerald-600'
                            : 'bg-black/10'
                        }`}
                      />
                      <p
                        className={`text-[10px] sm:text-xs font-bold text-center truncate ${
                          reached ? 'opacity-100' : 'opacity-50'
                        }`}
                      >
                        {step.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isCancelled && (
            <div className="pt-2 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate(`/menu?table=${order.table_number}`)}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-xs sm:text-sm font-bold hover:bg-neutral-800 inline-flex items-center gap-2 cursor-pointer"
              >
                <Utensils className="w-4 h-4" />
                Back to Table {order.table_number} Menu
              </button>
            </div>
          )}

          {isCompleted && (
            <div className="pt-1 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200/80">
              <p className="text-xs font-bold text-emerald-900 inline-flex items-center gap-1.5">
                <Heart className="w-4 h-4 text-[#E5391B] fill-current" />
                We hope you enjoyed your meal at RikZen Fast Food!
              </p>
              <button
                type="button"
                onClick={() => onNavigate(`/menu?table=${order.table_number}`)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-[#E5391B] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Utensils className="w-3.5 h-3.5" />
                Order Again
              </button>
            </div>
          )}
        </motion.section>

        {/* Real-Time Payment Status Bar */}
        <section className="bg-white rounded-3xl border border-neutral-200 p-5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isPaid
                  ? 'bg-emerald-50 text-emerald-700'
                  : isNotReceived
                    ? 'bg-red-50 text-red-700'
                    : 'bg-amber-50 text-amber-700'
              }`}
            >
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-neutral-500">Payment Status</p>
              {isPaid ? (
                <p className="text-sm font-extrabold text-emerald-700 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  PAID · Payment Received
                </p>
              ) : isVerificationPending ? (
                <p className="text-sm font-extrabold text-amber-800 inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  PAYMENT VERIFICATION PENDING
                </p>
              ) : isNotReceived ? (
                <p className="text-sm font-extrabold text-red-700 inline-flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  PAYMENT NOT RECEIVED
                </p>
              ) : (
                <p className="text-sm font-extrabold text-amber-800 inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  PAYMENT PENDING
                </p>
              )}
            </div>
          </div>

          {!isPaid && !isVerificationPending && !isCancelled && isConfirmedOrFurther && (
            <button
              type="button"
              disabled={requestingPaymentVerify}
              onClick={handleIHavePaid}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-extrabold hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {requestingPaymentVerify ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {requestingPaymentVerify ? 'Notifying...' : 'I Have Paid'}
            </button>
          )}
        </section>

        {/* Bill & Quick Actions Bar (Available once Confirmed and Not Cancelled) */}
        {isConfirmedOrFurther && (
          <section className="bg-white rounded-3xl border border-neutral-200 p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold text-neutral-900 inline-flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#E5391B]" />
                Digital Bill &amp; Actions
              </h2>
              {publicBillUrl && (
                <a
                  href={publicBillUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-[#E5391B] hover:underline inline-flex items-center gap-1"
                >
                  Open Bill Page
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setBillModalOpen(true)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-neutral-900 text-white text-xs sm:text-sm font-extrabold hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                VIEW BILL
              </button>

              <button
                type="button"
                disabled={downloadingPdf}
                onClick={handleDownloadPdf}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-[#E5391B] text-white text-xs sm:text-sm font-extrabold hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {downloadingPdf ? 'Preparing...' : 'DOWNLOAD PDF'}
              </button>

              <button
                type="button"
                onClick={handleShareBill}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-900 text-xs sm:text-sm font-extrabold active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-[#E5391B]" />
                SHARE BILL
              </button>
            </div>

            {canRequestBill && (
              <button
                type="button"
                disabled={requestingBill}
                onClick={handleRequestBill}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60"
              >
                {requestingBill ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                {requestingBill ? 'Requesting Bill...' : 'Request Table Bill'}
              </button>
            )}
          </section>
        )}

        {/* Honest 2-Mode Payment QR Card (When Confirmed, Unpaid, and Not Cancelled) */}
        {isConfirmedOrFurther && !isPaid && (showUploadedQr || showDynamicUpiQr) && (
          <section className="bg-white rounded-3xl border-2 border-neutral-900 p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5 shadow-sm">
            {showUploadedQr ? (
              <div className="bg-white p-2 rounded-2xl border border-neutral-200 shrink-0">
                <img
                  src={activeQrImageUrl}
                  alt={`Payment QR for ${activeMerchantName}`}
                  className="w-44 h-44 object-contain"
                />
              </div>
            ) : (
              <div className="bg-white p-2 rounded-2xl border border-neutral-200 shrink-0">
                <QRCodeSVG
                  value={dynamicUpiUri}
                  size={172}
                  level="H"
                  includeMargin={true}
                  fgColor="#000000"
                  bgColor="#FFFFFF"
                />
              </div>
            )}

            <div className="flex-1 text-center sm:text-left space-y-2.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151110] text-white text-[11px] font-extrabold tracking-wide">
                <QrCode className="w-3.5 h-3.5 text-amber-300" />
                SCAN TO PAY
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] tabular-nums">
                {formatRupees(order.total)}
              </p>
              <p className="text-xs font-bold text-neutral-900">{activeMerchantName}</p>

              {isVerificationPending && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-900">
                  Payment Verification Pending — Waiting for restaurant owner to verify your
                  payment.
                </div>
              )}
              {isNotReceived && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs font-bold text-red-800">
                  Payment could not be verified. Please contact the restaurant counter.
                </div>
              )}

              {showDynamicUpiQr ? (
                <>
                  <p className="text-xs font-bold text-emerald-700">
                    Exact amount pre-filled · Order #{orderCode}
                  </p>
                  {activeUpiId && (
                    <p className="text-xs font-mono text-neutral-600 truncate">
                      UPI ID: <span className="font-bold text-neutral-900">{activeUpiId}</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-neutral-700 font-medium">
                  Scan this QR using any UPI app and pay{' '}
                  <span className="font-bold text-neutral-900">{formatRupees(order.total)}</span>.
                </p>
              )}

              <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                {showDynamicUpiQr && (
                  <a
                    href={dynamicUpiUri}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-extrabold hover:bg-[#C82E14] inline-flex items-center gap-1.5"
                  >
                    <Smartphone className="w-4 h-4" />
                    Pay Now · {formatRupees(order.total)}
                  </a>
                )}
                <button
                  type="button"
                  disabled={downloadingQr}
                  onClick={handleDownloadQr}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-extrabold hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {downloadingQr ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {downloadingQr ? 'Saving QR...' : 'Download QR'}
                </button>
                {!isVerificationPending && (
                  <button
                    type="button"
                    disabled={requestingPaymentVerify}
                    onClick={handleIHavePaid}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-extrabold hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {requestingPaymentVerify ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {requestingPaymentVerify ? 'Sending...' : 'I Have Paid'}
                  </button>
                )}
              </div>

              <p className="text-[11px] text-neutral-500">
                PhonePe · Google Pay · Paytm · BHIM
              </p>
            </div>
          </section>
        )}

        {/* Full Order Details Card */}
        <section className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-neutral-100">
            <div>
              <h2 className="font-display text-lg font-extrabold text-neutral-900">
                Order Details
              </h2>
              <p className="text-xs text-neutral-500">RikZen Fast Food · Fresh Table Service</p>
            </div>
            <span className="font-mono text-sm font-extrabold text-[#E5391B]">#{orderCode}</span>
          </div>

          <div className="bg-neutral-50 rounded-2xl p-4 grid grid-cols-2 gap-y-3 gap-x-4 text-xs sm:text-sm">
            <div>
              <p className="text-neutral-500 text-xs">Customer</p>
              <p className="font-bold text-neutral-900 truncate">{order.customer_name}</p>
            </div>
            <div className="text-right">
              <p className="text-neutral-500 text-xs">Table</p>
              <p className="font-bold text-neutral-900">Table {order.table_number}</p>
            </div>
            <div>
              <p className="text-neutral-500 text-xs">Mobile</p>
              <p className="font-mono font-semibold text-neutral-800 inline-flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-neutral-400" />
                {formatIndianMobileDisplay(order.customer_mobile)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-neutral-500 text-xs">Placed At</p>
              <p className="font-medium text-neutral-800">
                {date} · {time}
              </p>
            </div>
          </div>

          {/* Items Breakdown */}
          <div>
            <div className="grid grid-cols-12 text-xs font-semibold text-neutral-500 pb-2 border-b border-neutral-200">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-2 text-right">Total</span>
            </div>
            <div className="divide-y divide-neutral-100 tabular-nums">
              {order.items.map((line, idx) => (
                <div
                  key={`${line.menu_item_id}_${idx}`}
                  className="py-3 grid grid-cols-12 items-center text-sm"
                >
                  <div className="col-span-6 pr-2">
                    <p className="font-semibold text-neutral-900 leading-snug">{line.name}</p>
                    {line.regular_price > line.unit_price && (
                      <p className="text-[11px] text-emerald-700 font-medium">
                        Offer {formatRupees(line.unit_price)} (Reg{' '}
                        {formatRupees(line.regular_price)})
                      </p>
                    )}
                  </div>
                  <span className="col-span-2 text-center font-mono text-neutral-700">
                    {line.quantity}
                  </span>
                  <span className="col-span-2 text-right font-mono text-neutral-600">
                    {formatRupees(line.unit_price)}
                  </span>
                  <span className="col-span-2 text-right font-mono font-bold text-neutral-900">
                    {formatRupees(line.line_total)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {order.notes && (
            <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3.5 py-2.5 text-xs text-neutral-700">
              <span className="font-bold text-neutral-900">Special Note:</span> {order.notes}
            </div>
          )}

          {/* Totals */}
          <div className="border-t border-neutral-200 pt-4 space-y-2 tabular-nums">
            <div className="flex items-center justify-between text-sm text-neutral-600">
              <span>Subtotal</span>
              <span className="font-mono font-semibold text-neutral-900">
                {formatRupees(order.subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-emerald-700 font-medium">
              <span>Discount</span>
              <span className="font-mono font-bold">
                {order.discount > 0 ? `-${formatRupees(order.discount)}` : formatRupees(0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-lg font-extrabold text-neutral-900 pt-2 border-t border-neutral-200">
              <span>TOTAL</span>
              <span className="font-mono text-[#E5391B] text-xl">
                {formatRupees(order.total)}
              </span>
            </div>
          </div>
        </section>

        {/* Footer Quick Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-6 text-xs">
          <button
            type="button"
            onClick={() => onNavigate(`/menu?table=${order.table_number}`)}
            className="font-bold text-neutral-700 hover:text-[#E5391B] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Utensils className="w-3.5 h-3.5" />
            Open Table {order.table_number} Menu
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/find-order')}
            className="font-bold text-neutral-700 hover:text-[#E5391B] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            Search Another Order
          </button>
        </div>
      </main>

      {/* Bill Preview Modal */}
      <BillPreviewModal
        order={billModalOpen ? order : null}
        onClose={() => setBillModalOpen(false)}
        paymentSettings={paymentSettings}
      />
    </div>
  );
};
