import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Heart,
  Loader2,
  QrCode,
  Receipt,
  RefreshCw,
  Send,
  Settings,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import {
  downloadOrderBillPdf,
  ensureOrderPdfGenerated,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRupees,
} from '../lib/orderService';
import { buildDynamicUpiUri, DEFAULT_PAYMENT_SETTINGS } from '../lib/upiPayment';
import { GeneratedBillResult, OrderRecord, PaymentSettings } from '../types/restaurant';
import { FoodArtIcon } from './FoodArtIcons';

interface BillPreviewModalProps {
  order: OrderRecord | null;
  onClose: () => void;
  isOwnerView?: boolean;
  whatsappConfigured?: boolean;
  paymentSettings?: PaymentSettings;
  onSendWhatsApp?: (order: OrderRecord) => Promise<void>;
  onMarkPaid?: (order: OrderRecord) => Promise<void>;
  onOpenSettings?: () => void;
  isSendingWhatsApp?: boolean;
  isUpdatingPayment?: boolean;
}

export const BillPreviewModal: React.FC<BillPreviewModalProps> = ({
  order,
  onClose,
  isOwnerView = false,
  whatsappConfigured = true,
  paymentSettings = DEFAULT_PAYMENT_SETTINGS,
  onSendWhatsApp,
  onMarkPaid,
  onOpenSettings,
  isSendingWhatsApp = false,
  isUpdatingPayment = false,
}) => {
  const [viewMode, setViewMode] = useState<'pdf' | 'receipt'>('pdf');
  const [billMeta, setBillMeta] = useState<GeneratedBillResult | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const loadOrGeneratePdf = useCallback(
    async (targetOrder: OrderRecord, forceRegenerate = false) => {
      setLoadingPdf(true);
      setPdfError(null);
      try {
        const result = await ensureOrderPdfGenerated(targetOrder, {
          forceRegenerate,
          persistIfOwner: isOwnerView,
        });
        setBillMeta(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bill generation failed.';
        console.error('[RikZen Bill Viewer Error]', err);
        setPdfError(msg);
      } finally {
        setLoadingPdf(false);
      }
    },
    [isOwnerView],
  );

  useEffect(() => {
    if (!order) {
      setBillMeta(null);
      setPdfError(null);
      setDownloadError(null);
      return;
    }
    setBillMeta(null);
    setPdfError(null);
    setDownloadError(null);
    setViewMode('pdf');
    if (order.pdf_url || order.pdf_ready || order.bill_status !== 'not_generated') {
      void loadOrGeneratePdf(order, false);
    }
  }, [order?.id, loadOrGeneratePdf]);

  if (!order) return null;

  const isNotGeneratedYet =
    !loadingPdf &&
    !pdfError &&
    !billMeta?.pdf_url &&
    !order.pdf_url &&
    order.bill_status === 'not_generated';
  const isWaNotConfiguredError =
    order.whatsapp_error.toLowerCase().includes('not configured') ||
    (!whatsappConfigured && order.whatsapp_status === 'failed');

  const { date, time } = formatOrderDate(order.created_at);
  const orderCode = (order.order_code || `RK${order.order_number}`).toUpperCase();
  const activePdfUrl = billMeta?.pdf_url || order.pdf_url || '';
  const activeDownloadUrl = activePdfUrl ? `${activePdfUrl}&download=1` : '';
  const activeFilename = billMeta?.filename || `RikZen-Fast-Food-Bill-${orderCode}.pdf`;
  const isBusySending =
    isSendingWhatsApp ||
    order.whatsapp_status === 'sending' ||
    order.whatsapp_status === 'retrying';

  const activeUpiId = billMeta?.upi_id || paymentSettings.upi_id || '';
  const activeMerchantName = paymentSettings.merchant_name || 'RikZen Fast Food';
  const dynamicUpiUri =
    buildDynamicUpiUri({
      upiId: activeUpiId,
      merchantName: activeMerchantName,
      amount: order.total,
      orderCode,
      tableNumber: order.table_number,
    }) ||
    billMeta?.upi_uri ||
    order.upi_uri ||
    '';

  const paymentStatus = order.payment_status || (order.status === 'completed' ? 'paid' : 'pending');
  const isPaid = paymentStatus === 'paid';

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const result = await downloadOrderBillPdf(order);
      setBillMeta(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to download PDF bill.';
      console.error('[RikZen Bill Modal Download Error]', err);
      setDownloadError(msg);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto print:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-2xl bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-2xl my-auto flex flex-col max-h-[92vh]"
        >
          {/* Header Bar */}
          <div className="relative bg-[#151110] text-white px-5 sm:px-6 py-4 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <FoodArtIcon kind="burger" className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <h2
                  id="bill-modal-title"
                  className="font-display text-lg sm:text-xl font-extrabold tracking-tight truncate"
                >
                  RIKZEN FAST FOOD · #{orderCode}
                </h2>
                <p className="text-xs text-amber-200/90 font-medium truncate">
                  {order.customer_name} · Table {order.table_number} · {formatRupees(order.total)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close bill viewer"
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mode Switcher + Direct New-Tab PDF Link */}
          <div className="px-5 py-3 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="inline-flex rounded-xl bg-white border border-neutral-200 p-1">
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  viewMode === 'pdf'
                    ? 'bg-[#E5391B] text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                PDF Viewer
              </button>
              <button
                type="button"
                onClick={() => setViewMode('receipt')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  viewMode === 'receipt'
                    ? 'bg-[#E5391B] text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                Receipt &amp; UPI QR
              </button>
            </div>

            {activePdfUrl && !loadingPdf && !pdfError && (
              <a
                href={activePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-800 hover:bg-neutral-100 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#E5391B]" />
                Open PDF in New Tab
              </a>
            )}
          </div>

          {/* Body Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {/* Real-Time Payment Status Strip */}
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs">
                <CreditCard className="w-4 h-4 text-neutral-500 shrink-0" />
                <span className="font-bold text-neutral-700">Payment Status:</span>
                {isPaid ? (
                  <span className="inline-flex items-center gap-1.5 font-extrabold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    Payment Received
                  </span>
                ) : paymentStatus === 'failed' ? (
                  <span className="inline-flex items-center gap-1.5 font-extrabold text-red-700">
                    <XCircle className="w-4 h-4" />
                    Payment Failed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-extrabold text-amber-800">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    Payment Pending
                  </span>
                )}
              </div>

              {isOwnerView && onMarkPaid && !isPaid && order.status !== 'rejected' && (
                <button
                  type="button"
                  disabled={isUpdatingPayment}
                  onClick={() => onMarkPaid(order)}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {isUpdatingPayment ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Mark Paid
                </button>
              )}
            </div>

            {/* Real PDF Error Banner with Explicit Retry */}
            {pdfError && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center space-y-3">
                <div className="w-11 h-11 rounded-xl bg-red-100 text-red-700 flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-red-800">Bill generation failed</p>
                  <p className="text-xs text-red-700 mt-1">{pdfError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadOrGeneratePdf(order, true)}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-red-700 text-white text-xs font-bold hover:bg-red-800 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try Again
                </button>
              </div>
            )}

            {/* Embedded Real PDF Viewer */}
            {viewMode === 'pdf' && !pdfError && (
              <div className="space-y-3">
                {isNotGeneratedYet ? (
                  <div className="h-[360px] rounded-2xl border border-neutral-200 bg-neutral-50 flex flex-col items-center justify-center gap-4 text-center p-6">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-extrabold text-neutral-900">
                        PDF is not generated yet.
                      </p>
                      <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                        Generate the verified PDF receipt with exact-amount UPI QR for Order #{orderCode}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadOrGeneratePdf(order, false)}
                      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center gap-2 cursor-pointer"
                    >
                      <FileText className="w-4 h-4" />
                      Generate Bill
                    </button>
                  </div>
                ) : loadingPdf || !activePdfUrl ? (
                  <div className="h-[400px] rounded-2xl border border-neutral-200 bg-neutral-50 flex flex-col items-center justify-center gap-3 text-center p-6">
                    <Loader2 className="w-8 h-8 text-[#E5391B] animate-spin" />
                    <div>
                      <p className="text-sm font-bold text-neutral-900">Generating PDF bill...</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Verifying order #{orderCode} and embedding exact-amount UPI QR
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="rounded-2xl border border-neutral-200 overflow-hidden bg-neutral-100">
                      <iframe
                        src={activePdfUrl}
                        title={`RikZen Fast Food PDF Bill #${orderCode}`}
                        className="w-full h-[420px] sm:h-[470px] bg-white"
                      />
                    </div>
                    <p className="text-[11px] text-neutral-500 flex flex-wrap items-center justify-between gap-2 px-1">
                      <span className="font-mono truncate">{activeFilename}</span>
                      <span>
                        On mobile? Tap{' '}
                        <a
                          href={activePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-[#E5391B] underline"
                        >
                          Open PDF in New Tab
                        </a>{' '}
                        or switch to Receipt &amp; UPI QR.
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Structured Receipt Details View */}
            {viewMode === 'receipt' && (
              <div className="space-y-4">
                <div className="bg-neutral-50 rounded-2xl p-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs sm:text-sm">
                  <div>
                    <p className="text-neutral-500 text-xs">Customer</p>
                    <p className="font-bold text-neutral-900 truncate">{order.customer_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-neutral-500 text-xs">Order No</p>
                    <p className="font-mono font-bold text-[#E5391B]">#{orderCode}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500 text-xs">Mobile</p>
                    <p className="font-mono font-semibold text-neutral-800">
                      {formatIndianMobileDisplay(order.customer_mobile)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-neutral-500 text-xs">Table</p>
                    <p className="font-bold text-neutral-900">Table {order.table_number}</p>
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

                <div>
                  <div className="grid grid-cols-12 text-xs font-semibold text-neutral-500 pb-2 border-b border-neutral-200">
                    <span className="col-span-6">Item</span>
                    <span className="col-span-2 text-center">Qty</span>
                    <span className="col-span-2 text-right">Price</span>
                    <span className="col-span-2 text-right">Total</span>
                  </div>
                  <div className="divide-y divide-neutral-100 tabular-nums">
                    {order.items.map((line) => (
                      <div
                        key={line.menu_item_id}
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

                <div className="pt-3 border-t border-neutral-100 flex items-center justify-between gap-2 text-center">
                  <FoodArtIcon kind="fries" className="w-7 h-7 opacity-75 shrink-0" />
                  <div className="text-xs text-neutral-600">
                    <p className="font-bold text-neutral-900 inline-flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-[#E5391B] fill-current" />
                      Thank You for visiting RikZen Fast Food
                    </p>
                    <p className="text-neutral-500">We hope to serve you again!</p>
                  </div>
                  <FoodArtIcon kind="drink" className="w-7 h-7 opacity-75 shrink-0" />
                </div>
              </div>
            )}

            {/* Dynamic Exact-Amount UPI Payment QR Card (Crisp static monochrome QR — never animated) */}
            {order.status !== 'rejected' && (
              dynamicUpiUri ? (
                <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
                  <div className="bg-white p-2 rounded-xl border border-neutral-200 shrink-0">
                    <QRCodeSVG
                      value={dynamicUpiUri}
                      size={172}
                      level="H"
                      includeMargin={true}
                      fgColor="#000000"
                      bgColor="#FFFFFF"
                    />
                  </div>
                  <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151110] text-white text-[11px] font-extrabold tracking-wide">
                      <QrCode className="w-3.5 h-3.5 text-amber-300" />
                      SCAN TO PAY
                    </div>
                    <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] tabular-nums">
                      {formatRupees(order.total)}
                    </p>
                    <p className="text-xs font-bold text-emerald-700">
                      Pay this exact amount · Order #{orderCode}
                    </p>
                    {activeUpiId && (
                      <p className="text-xs font-mono text-neutral-600 truncate">
                        UPI ID: <span className="font-bold text-neutral-900">{activeUpiId}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-neutral-500">
                      Scan using any UPI app · PhonePe · Google Pay · Paytm · BHIM
                    </p>
                    {!isPaid && (
                      <div className="pt-1">
                        <a
                          href={dynamicUpiUri}
                          className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1.5"
                        >
                          <Smartphone className="w-4 h-4" />
                          Open UPI App to Pay {formatRupees(order.total)}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : isOwnerView ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-amber-900">
                    <p className="font-extrabold">UPI Payment QR not configured yet</p>
                    <p className="mt-0.5 text-amber-800">
                      Add your Restaurant UPI ID or upload your QR screenshot in Payment Settings to
                      embed dynamic exact-amount UPI QRs on every bill.
                    </p>
                  </div>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Payment Settings
                    </button>
                  )}
                </div>
              ) : null
            )}

            {/* Owner WhatsApp Real Delivery Status Box */}
            {isOwnerView && (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-bold">
                  <span className="text-neutral-600">WhatsApp PDF Bill Delivery</span>
                  {order.whatsapp_status === 'sent' && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      BILL SENT
                    </span>
                  )}
                  {(order.whatsapp_status === 'sending' || order.whatsapp_status === 'retrying') && (
                    <span className="inline-flex items-center gap-1 text-blue-700">
                      <Clock className="w-3.5 h-3.5" />
                      {order.whatsapp_status === 'retrying' ? 'Retrying...' : 'Sending...'}
                    </span>
                  )}
                  {order.whatsapp_status === 'failed' && (
                    <span className="inline-flex items-center gap-1 text-red-700">
                      <XCircle className="w-3.5 h-3.5" />
                      SEND FAILED
                    </span>
                  )}
                  {order.whatsapp_status === 'not_sent' && (
                    <span className="text-neutral-500">Ready to Share</span>
                  )}
                </div>
                {order.whatsapp_error && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-red-700 leading-relaxed">
                      {isWaNotConfiguredError
                        ? 'WhatsApp API is not configured.'
                        : order.whatsapp_error}
                    </p>
                    {isWaNotConfiguredError && onOpenSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSettings();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Open Settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Download Error Feedback + Explicit Retry & Direct Fallback Link */}
            {downloadError && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 space-y-2">
                <p className="text-xs font-bold text-red-800">Download failed: {downloadError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Download
                  </button>
                  {activeDownloadUrl && (
                    <a
                      href={activeDownloadUrl}
                      download={activeFilename}
                      className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-800 text-xs font-bold"
                    >
                      Direct Download Link
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Modal Action Footer */}
          <div className="p-4 sm:p-5 bg-neutral-50 border-t border-neutral-200 flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              disabled={downloading || loadingPdf}
              onClick={handleDownload}
              className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-neutral-900 text-white font-bold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {downloading ? 'Downloading PDF...' : 'Download PDF'}
            </button>

            {isOwnerView && onSendWhatsApp && (
              <button
                type="button"
                disabled={isBusySending || loadingPdf}
                onClick={() => onSendWhatsApp(order)}
                className={`flex-1 min-h-[48px] px-4 py-2.5 rounded-xl text-white font-bold text-sm active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                  order.whatsapp_status === 'failed'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {isBusySending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {order.whatsapp_status === 'retrying' ? 'Retrying...' : 'Sending...'}
                  </>
                ) : order.whatsapp_status === 'failed' ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Retry Share
                  </>
                ) : order.whatsapp_status === 'sent' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Bill Sent (Resend)
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Share Bill
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
