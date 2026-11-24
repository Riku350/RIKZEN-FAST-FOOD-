import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileText,
  Heart,
  Loader2,
  Printer,
  QrCode,
  Share2,
  Smartphone,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  copyBillLinkToClipboard,
  getPublicBillUrl,
  shareBillNative,
  shareBillPdfNative,
} from '../lib/billShare';
import { generateClientBillPdfBlob } from '../lib/clientPdfBill';
import { downloadPaymentQrPng } from '../lib/paymentQrDownload';
import {
  customerRequestPaymentVerification,
  fetchPublicBillById,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRupees,
  isCancelledOrderStatus,
  PublicBillPayload,
  subscribeToOrder,
  subscribeToPaymentSettings,
} from '../lib/orderService';
import { customerVoiceManager } from '../lib/customerVoiceManager';
import { buildDynamicUpiUri, DEFAULT_PAYMENT_SETTINGS } from '../lib/upiPayment';
import { PaymentSettings } from '../types/restaurant';
import { CustomerVoiceBanner } from './CustomerVoiceBanner';
import { FoodArtIcon } from './FoodArtIcons';
import { PaymentConfirmModal } from './PaymentConfirmModal';

interface PublicBillPageProps {
  billId: string;
  onNavigate: (path: string) => void;
}

export const PublicBillPage: React.FC<PublicBillPageProps> = ({ billId, onNavigate }) => {
  const [bill, setBill] = useState<PublicBillPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [requestingVerify, setRequestingVerify] = useState(false);
  const [confirmPaidOpen, setConfirmPaidOpen] = useState(false);
  const [livePaymentSettings, setLivePaymentSettings] =
    useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);

  useEffect(() => {
    const unsub = subscribeToPaymentSettings((settings) => {
      setLivePaymentSettings(settings);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPublicBillById(billId)
      .then((data) => {
        if (!active) return;
        setBill(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load this bill.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [billId]);

  const liveOrderId =
    bill?.order_id || (/^ord_[a-zA-Z0-9_-]{20,124}$/.test(billId.trim()) ? billId.trim() : '');

  // Keep payment & order status updated in real time from Firestore + trigger customer voice updates
  useEffect(() => {
    if (!liveOrderId) return;
    const unsub = subscribeToOrder(liveOrderId, (ord) => {
      if (!ord) return;
      customerVoiceManager.syncRealtimeOrderSnapshot(ord);
      setBill((prev) =>
        prev
          ? {
              ...prev,
              order_id: ord.id,
              status: ord.status,
              payment_status: ord.payment_status,
              paymentStatus: ord.paymentStatus || ord.payment_status,
              payment_requested_at: ord.payment_requested_at || '',
            }
          : prev,
      );
    });
    return () => unsub();
  }, [liveOrderId]);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    window.setTimeout(() => {
      setActionFeedback((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const handleDownloadPdf = async () => {
    if (!bill) return;
    setDownloading(true);
    try {
      let blob: Blob | null = null;
      if (bill.pdf_url) {
        try {
          const downloadUrl = `${bill.pdf_url}${bill.pdf_url.includes('?') ? '&' : '?'}download=1`;
          const response = await fetch(downloadUrl, { method: 'GET', cache: 'no-store' });
          if (response.ok) {
            const buf = await response.arrayBuffer();
            const header = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
            if (buf.byteLength >= 512 && header === '%PDF-') {
              blob = new Blob([buf], { type: 'application/pdf' });
            }
          }
        } catch {
          blob = null;
        }
      }
      if (!blob) {
        blob = await generateClientBillPdfBlob(
          {
            order_code: bill.order_code,
            order_number: Number(bill.order_code.replace(/\D/g, '')) || 1000,
            table_number: bill.table_number,
            customer_name: bill.customer_name,
            customer_mobile: bill.customer_mobile,
            items: bill.items,
            subtotal: bill.subtotal,
            discount: bill.discount,
            total: bill.total,
            notes: '',
            payment_status: bill.payment_status,
            created_at: bill.created_at_iso,
          },
          bill.payment_qr_snapshot || null,
        );
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = bill.filename || `RikZen-Fast-Food-Bill-${bill.order_code}.pdf`;
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      showToast('Bill PDF downloaded.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to download bill.');
    } finally {
      setDownloading(false);
    }
  };

  const resolvedQrSnap = bill?.payment_qr_snapshot;
  const resolvedMode =
    resolvedQrSnap?.mode || livePaymentSettings.payment_mode || 'dynamic_upi';
  const resolvedMerchantName =
    resolvedQrSnap?.merchant_name || livePaymentSettings.merchant_name || 'RikZen Fast Food';
  const resolvedQrImageUrl =
    resolvedQrSnap?.qr_image_url || livePaymentSettings.qr_image_url || '';
  const resolvedUpiId = resolvedQrSnap?.upi_id || livePaymentSettings.upi_id || '';
  const resolvedUpiUri =
    resolvedMode === 'dynamic_upi'
      ? resolvedQrSnap?.upi_uri ||
        (bill
          ? buildDynamicUpiUri({
              upiId: resolvedUpiId,
              merchantName: resolvedMerchantName,
              amount: bill.total,
              orderCode: bill.order_code,
              tableNumber: bill.table_number,
            })
          : '') ||
        ''
      : '';

  const hasUploadedQr = resolvedMode === 'uploaded_qr' && Boolean(resolvedQrImageUrl);
  const hasDynamicUpi = resolvedMode === 'dynamic_upi' && Boolean(resolvedUpiUri);
  const hasAnyPaymentQr = hasUploadedQr || hasDynamicUpi;

  // Announce payment QR availability once per order when unpaid bill QR is displayed
  useEffect(() => {
    if (!bill || !liveOrderId) return;
    const payStatus = bill.paymentStatus || bill.payment_status;
    const cancelled = isCancelledOrderStatus(bill.status);
    if (!cancelled && payStatus === 'pending' && hasAnyPaymentQr) {
      customerVoiceManager.announceOrderEvent({
        orderId: liveOrderId,
        orderCode: bill.order_code,
        tableNumber: bill.table_number,
        eventKey: 'payment_qr_available',
      });
    }
  }, [bill?.order_code, bill?.payment_status, bill?.paymentStatus, bill?.status, bill?.table_number, liveOrderId, hasAnyPaymentQr]);

  const handleDownloadQr = async () => {
    if (!bill || downloadingQr || !hasAnyPaymentQr) return;
    setDownloadingQr(true);
    try {
      await downloadPaymentQrPng({
        mode: hasUploadedQr ? 'uploaded_qr' : 'dynamic_upi',
        upiUri: resolvedUpiUri,
        qrImageUrl: resolvedQrImageUrl,
        merchantName: resolvedMerchantName,
        upiId: resolvedUpiId,
        amount: bill.total,
        orderCode: bill.order_code,
        tableNumber: bill.table_number,
      });
      showToast('Payment QR downloaded.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to download Payment QR.');
    } finally {
      setDownloadingQr(false);
    }
  };

  const handleShareBill = async () => {
    if (!bill) return;
    const outcome = await shareBillNative(bill);
    if (outcome.method === 'copied') {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2500);
    }
    if (outcome.method !== 'cancelled') {
      showToast(outcome.message);
    }
  };

  const handleSharePdf = async () => {
    if (!bill) return;
    setSharingPdf(true);
    try {
      const outcome = await shareBillPdfNative(bill);
      if (outcome.method === 'copied') {
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 2500);
      }
      if (outcome.method !== 'cancelled') {
        showToast(outcome.message);
      }
    } finally {
      setSharingPdf(false);
    }
  };

  const handleCopyLink = async () => {
    if (!bill) return;
    const ok = await copyBillLinkToClipboard(getPublicBillUrl(bill.public_bill_id));
    if (ok) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2500);
      showToast('Bill link copied.');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleConfirmCustomerIHavePaid = async () => {
    if (!liveOrderId || !bill || requestingVerify) return;
    const curPay = bill.paymentStatus || bill.payment_status;
    if (curPay === 'paid' || curPay === 'verification_requested') {
      setConfirmPaidOpen(false);
      return;
    }
    setRequestingVerify(true);
    void customerVoiceManager.unlockOnUserGesture(false);
    try {
      await customerRequestPaymentVerification(liveOrderId);
      setConfirmPaidOpen(false);
      setBill((prev) =>
        prev
          ? {
              ...prev,
              payment_status: 'verification_requested',
              paymentStatus: 'verification_requested',
              payment_requested_at: new Date().toISOString(),
            }
          : prev,
      );
      customerVoiceManager.announceOrderEvent({
        orderId: liveOrderId,
        orderCode: bill.order_code,
        tableNumber: bill.table_number,
        eventKey: 'payment_verification_requested',
      });
      showToast('Payment request sent to RikZen Fast Food. Please wait for confirmation.');
    } catch (err) {
      setConfirmPaidOpen(false);
      showToast(err instanceof Error ? err.message : 'Unable to request payment verification.');
    } finally {
      setRequestingVerify(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center p-6 text-center gap-3">
        <Loader2 className="w-8 h-8 text-[#E5391B] animate-spin" />
        <p className="text-sm font-bold text-neutral-800">Loading your RikZen Fast Food bill...</p>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-5">
        <div className="max-w-md w-full bg-white rounded-3xl border border-neutral-200 p-7 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-xl font-extrabold text-neutral-900">
              Bill Unavailable
            </h1>
            <p className="text-sm text-neutral-600 mt-1.5">
              {error || 'This bill link could not be found. Please ask at the counter.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/menu')}
            className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#E5391B] text-white text-sm font-bold hover:bg-[#C82E14] inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to RikZen Menu
          </button>
        </div>
      </div>
    );
  }

  const { date, time } = formatOrderDate(bill.created_at_iso);
  const currentPaymentStatus = bill.paymentStatus || bill.payment_status;
  const isPaid = currentPaymentStatus === 'paid';
  const isVerificationPending = currentPaymentStatus === 'verification_requested';
  const isNotReceived = currentPaymentStatus === 'not_received';
  const isCancelled = isCancelledOrderStatus(bill.status);
  const isUploadedQr = hasUploadedQr;
  const isDynamicUpi = hasDynamicUpi;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-neutral-900 pb-16 print:bg-white print:pb-0">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 print:hidden">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onNavigate(`/menu?table=${bill.table_number}`)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Table {bill.table_number} Menu
          </button>
          <span className="font-mono text-xs font-extrabold text-[#E5391B]">
            BILL #{bill.order_code}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-5">
        {/* Subtle Lightweight Thank You Banner Animation (never blocks or obscures QR) */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-3xl bg-[#151110] text-white px-5 py-6 text-center shadow-lg print:shadow-none print:rounded-none"
        >
          <div className="flex items-center justify-center gap-4 mb-3">
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: [0, -4, 0], opacity: 1 }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            >
              <FoodArtIcon kind="burger" className="w-9 h-9" />
            </motion.div>
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: [0, -5, 0], opacity: 1 }}
              transition={{ duration: 3.1, delay: 0.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <FoodArtIcon kind="fries" className="w-9 h-9" />
            </motion.div>
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: [0, -4, 0], opacity: 1 }}
              transition={{ duration: 2.9, delay: 0.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <FoodArtIcon kind="drink" className="w-9 h-9" />
            </motion.div>
          </div>

          <div className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-extrabold tracking-widest uppercase mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            THANK YOU!
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
            RIKZEN FAST FOOD
          </h1>
          <p className="text-xs sm:text-sm text-amber-100/90 mt-1.5 max-w-md mx-auto">
            Thank you for visiting RikZen Fast Food. We are happy to serve you!
          </p>
        </motion.section>

        {/* Live Voice Announcements Control */}
        <CustomerVoiceBanner compact />

        {/* Action Toast Feedback */}
        {actionFeedback && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-800 flex items-center gap-2 print:hidden">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {actionFeedback}
          </div>
        )}

        {/* Bill Card */}
        <section className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden print:border-neutral-300 print:shadow-none">
          {/* Payment Status Strip */}
          <div className="px-5 py-3.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <CreditCard className="w-4 h-4 text-neutral-500" />
              <span className="font-bold text-neutral-600">Payment Status:</span>
              {isPaid ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-700 text-white font-extrabold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  PAID · PAYMENT CONFIRMED
                </span>
              ) : isVerificationPending ? (
                <span className="inline-flex items-center gap-1 font-extrabold text-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Payment Verification Pending
                </span>
              ) : isNotReceived ? (
                <span className="inline-flex items-center gap-1 font-extrabold text-red-700">
                  <XCircle className="w-4 h-4" />
                  Payment Not Confirmed
                </span>
              ) : currentPaymentStatus === 'failed' ? (
                <span className="inline-flex items-center gap-1 font-extrabold text-red-700">
                  <XCircle className="w-4 h-4" />
                  Payment Not Confirmed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-extrabold text-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Payment Pending
                </span>
              )}
            </div>
            {isCancelled ? (
              <span className="text-xs font-extrabold text-red-700 inline-flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                Order Cancelled
              </span>
            ) : (
              <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Order Confirmed
              </span>
            )}
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* Customer & Order Meta */}
            <div className="bg-neutral-50 rounded-2xl p-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs sm:text-sm">
              <div>
                <p className="text-neutral-500 text-xs">Customer</p>
                <p className="font-bold text-neutral-900 truncate">{bill.customer_name}</p>
              </div>
              <div className="text-right">
                <p className="text-neutral-500 text-xs">Order Number</p>
                <p className="font-mono font-extrabold text-[#E5391B]">#{bill.order_code}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs">Mobile</p>
                <p className="font-mono font-semibold text-neutral-800">
                  {formatIndianMobileDisplay(bill.customer_mobile)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-neutral-500 text-xs">Table</p>
                <p className="font-bold text-neutral-900">Table {bill.table_number}</p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs">Date</p>
                <p className="font-medium text-neutral-800">{date}</p>
              </div>
              <div className="text-right">
                <p className="text-neutral-500 text-xs">Time</p>
                <p className="font-medium text-neutral-800">{time}</p>
              </div>
            </div>

            {/* Ordered Items */}
            <div>
              <div className="grid grid-cols-12 text-xs font-semibold text-neutral-500 pb-2 border-b border-neutral-200">
                <span className="col-span-6">Item</span>
                <span className="col-span-2 text-center">Qty</span>
                <span className="col-span-2 text-right">Price</span>
                <span className="col-span-2 text-right">Total</span>
              </div>
              <div className="divide-y divide-neutral-100 tabular-nums">
                {bill.items.map((line) => (
                  <div
                    key={`${line.menu_item_id}-${line.name}`}
                    className="py-2.5 grid grid-cols-12 items-center text-sm"
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

            {/* Totals */}
            <div className="border-t border-neutral-200 pt-4 space-y-2 tabular-nums">
              <div className="flex items-center justify-between text-sm text-neutral-600">
                <span>Subtotal</span>
                <span className="font-mono font-semibold text-neutral-900">
                  {formatRupees(bill.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-emerald-700 font-medium">
                <span>Discount</span>
                <span className="font-mono font-bold">
                  {bill.discount > 0 ? `-${formatRupees(bill.discount)}` : formatRupees(0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-lg font-extrabold text-neutral-900 pt-2.5 border-t border-neutral-200">
                <span>TOTAL</span>
                <span className="font-mono text-[#E5391B] text-2xl">
                  {formatRupees(bill.total)}
                </span>
              </div>
            </div>

            {/* PAYMENT SECTION: Live Confirmed / Pending / Not Received + QR + Download QR + I HAVE PAID */}
            {!isCancelled && (
              <div className="rounded-2xl border-2 border-neutral-900 bg-white p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-100">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151110] text-white text-xs font-extrabold tracking-wider">
                      <QrCode className="w-3.5 h-3.5 text-amber-300" />
                      PAYMENT
                    </span>
                    <span className="text-xs font-bold text-neutral-600">Scan &amp; Pay</span>
                  </div>
                  <span className="font-mono text-xl sm:text-2xl font-extrabold text-[#E5391B] tabular-nums">
                    {formatRupees(bill.total)}
                  </span>
                </div>

                {/* Live Owner-Verified Payment Confirmed Card */}
                {isPaid ? (
                  <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-5 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <p className="text-lg font-extrabold text-emerald-900">
                      ✓ PAYMENT CONFIRMED
                    </p>
                    <p className="text-sm font-medium text-emerald-800">
                      Your payment has been verified by RikZen Fast Food.
                    </p>
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-700 text-white text-xs font-extrabold tracking-wider">
                      BILL STATUS: PAID
                    </span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Live Status Alerts */}
                    {isVerificationPending && (
                      <div className="rounded-2xl bg-amber-50 border border-amber-300 px-4 py-3.5 space-y-1">
                        <p className="text-sm font-extrabold text-amber-950 inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                          Payment Verification Pending
                        </p>
                        <p className="text-xs font-medium text-amber-900">
                          Payment request sent to RikZen Fast Food. Please wait for confirmation.
                        </p>
                      </div>
                    )}

                    {isNotReceived && (
                      <div className="rounded-2xl bg-red-50 border border-red-300 px-4 py-3.5 space-y-1">
                        <p className="text-sm font-extrabold text-red-900 inline-flex items-center gap-1.5">
                          <XCircle className="w-4 h-4 shrink-0" />
                          Payment Not Confirmed
                        </p>
                        <p className="text-xs font-medium text-red-800">
                          Please check your payment and contact the shop. You can scan the QR and
                          try again below.
                        </p>
                      </div>
                    )}

                    {/* QR Display + Download QR Directly Below QR */}
                    {(isUploadedQr || isDynamicUpi) && (
                      <div className="flex flex-col sm:flex-row items-center gap-5">
                        <div className="flex flex-col items-center gap-2.5 shrink-0">
                          {isUploadedQr && resolvedQrImageUrl ? (
                            <div className="bg-white p-2.5 rounded-2xl border border-neutral-200 shadow-xs">
                              <img
                                src={resolvedQrImageUrl}
                                alt={`Payment QR for ${resolvedMerchantName}`}
                                className="w-48 h-48 object-contain"
                              />
                            </div>
                          ) : isDynamicUpi && resolvedUpiUri ? (
                            <div className="bg-white p-2.5 rounded-2xl border border-neutral-200 shadow-xs">
                              <QRCodeSVG
                                value={resolvedUpiUri}
                                size={184}
                                level="H"
                                includeMargin={true}
                                fgColor="#000000"
                                bgColor="#FFFFFF"
                              />
                            </div>
                          ) : null}

                          <button
                            type="button"
                            disabled={downloadingQr}
                            onClick={handleDownloadQr}
                            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-extrabold hover:bg-neutral-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 print:hidden"
                          >
                            {downloadingQr ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                            {downloadingQr ? 'Saving QR...' : 'Download QR'}
                          </button>
                        </div>

                        <div className="flex-1 text-center sm:text-left space-y-2.5 min-w-0">
                          <p className="text-sm font-extrabold text-neutral-900">
                            Scan &amp; Pay · {resolvedMerchantName}
                          </p>
                          {isDynamicUpi ? (
                            <>
                              <p className="text-xs font-bold text-emerald-700">
                                Scan this QR using any UPI app to pay exact amount{' '}
                                {formatRupees(bill.total)} · #{bill.order_code}
                              </p>
                              {resolvedUpiId && (
                                <p className="text-xs font-mono text-neutral-600 truncate">
                                  UPI ID:{' '}
                                  <span className="font-bold text-neutral-900">{resolvedUpiId}</span>
                                </p>
                              )}
                              {resolvedUpiUri && (
                                <div className="pt-0.5 print:hidden">
                                  <a
                                    href={resolvedUpiUri}
                                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-extrabold hover:bg-[#C82E14] inline-flex items-center gap-1.5"
                                  >
                                    <Smartphone className="w-4 h-4" />
                                    Open UPI App · {formatRupees(bill.total)}
                                  </a>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs font-medium text-neutral-700 leading-relaxed">
                              Scan this QR code using PhonePe, Google Pay, Paytm, or BHIM and pay{' '}
                              <span className="font-bold text-neutral-900">
                                {formatRupees(bill.total)}
                              </span>
                              . After completing payment, tap <span className="font-bold">I HAVE PAID</span> below.
                            </p>
                          )}
                          <p className="text-[11px] text-neutral-500">
                            PhonePe · Google Pay · Paytm · BHIM
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Big Prominent I HAVE PAID Button (with Duplicate Protection) */}
                    {liveOrderId && (
                      <div className="pt-2 border-t border-neutral-100 print:hidden">
                        {isVerificationPending ? (
                          <button
                            type="button"
                            disabled
                            className="w-full min-h-[52px] px-5 py-3 rounded-2xl bg-amber-100 border border-amber-300 text-amber-900 font-extrabold text-sm inline-flex items-center justify-center gap-2 cursor-not-allowed"
                          >
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Payment Verification Pending
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={requestingVerify}
                            onClick={() => setConfirmPaidOpen(true)}
                            className="w-full min-h-[54px] px-5 py-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-base tracking-wide active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-sm"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                            I HAVE PAID
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons (Mobile + Desktop Native Website Bill Actions) */}
            <div className="pt-2 space-y-2.5 print:hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={downloading}
                  onClick={handleDownloadPdf}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-neutral-900 text-white font-bold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {downloading ? 'Downloading...' : 'Download Bill'}
                </button>

                <button
                  type="button"
                  onClick={handleShareBill}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  Share Bill
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={sharingPdf}
                  onClick={handleSharePdf}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {sharingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  Share PDF
                </button>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedLink ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedLink ? 'Copied' : 'Copy Link'}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Bill
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-neutral-100 text-center text-xs text-neutral-600">
              <p className="font-bold text-neutral-900 inline-flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-[#E5391B] fill-current" />
                Thank You for visiting RikZen Fast Food
              </p>
              <p className="text-neutral-500 mt-0.5">We hope to serve you again!</p>
            </div>
          </div>
        </section>
      </main>

      <PaymentConfirmModal
        open={confirmPaidOpen}
        orderCode={bill.order_code}
        totalAmount={bill.total}
        submitting={requestingVerify}
        onConfirm={handleConfirmCustomerIHavePaid}
        onCancel={() => setConfirmPaidOpen(false)}
      />
    </div>
  );
};
