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
} from 'lucide-react';
import {
  copyBillLinkToClipboard,
  getPublicBillUrl,
  shareBillNative,
  shareBillPdfNative,
} from '../lib/billShare';
import { generateClientBillPdfBlob } from '../lib/clientPdfBill';
import {
  fetchPublicBillById,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRupees,
  PublicBillPayload,
} from '../lib/orderService';
import { FoodArtIcon } from './FoodArtIcons';

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
  const [sharingPdf, setSharingPdf] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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
  const isPaid = bill.payment_status === 'paid';
  const qrSnap = bill.payment_qr_snapshot;
  const isUploadedQr = qrSnap?.mode === 'uploaded_qr' && Boolean(qrSnap.qr_image_url);
  const isDynamicUpi = qrSnap?.mode === 'dynamic_upi' && Boolean(qrSnap.upi_uri);

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
                <span className="inline-flex items-center gap-1 font-extrabold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Payment Received
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-extrabold text-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Payment Pending
                </span>
              )}
            </div>
            <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Order Confirmed
            </span>
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

            {/* Honest 2-Mode Payment QR Card (Immutable Snapshot — ZERO animations or cropping on QR) */}
            {(isUploadedQr || isDynamicUpi) && (
              <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
                {isUploadedQr && qrSnap?.qr_image_url ? (
                  <div className="bg-white p-2 rounded-xl border border-neutral-200 shrink-0">
                    <img
                      src={qrSnap.qr_image_url}
                      alt={`Payment QR for ${qrSnap.merchant_name || 'RikZen Fast Food'}`}
                      className="w-44 h-44 object-contain"
                    />
                  </div>
                ) : isDynamicUpi && qrSnap?.upi_uri ? (
                  <div className="bg-white p-2 rounded-xl border border-neutral-200 shrink-0">
                    <QRCodeSVG
                      value={qrSnap.upi_uri}
                      size={176}
                      level="H"
                      includeMargin={true}
                      fgColor="#000000"
                      bgColor="#FFFFFF"
                    />
                  </div>
                ) : null}

                <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151110] text-white text-[11px] font-extrabold tracking-wide">
                    <QrCode className="w-3.5 h-3.5 text-amber-300" />
                    SCAN TO PAY
                  </div>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] tabular-nums">
                    {formatRupees(bill.total)}
                  </p>
                  <p className="text-xs font-bold text-neutral-900">
                    {qrSnap?.merchant_name || 'RikZen Fast Food'}
                  </p>
                  {isDynamicUpi ? (
                    <>
                      <p className="text-xs font-bold text-emerald-700">
                        Scan to pay this exact bill amount · #{bill.order_code}
                      </p>
                      {qrSnap?.upi_id && (
                        <p className="text-xs font-mono text-neutral-600 truncate">
                          UPI ID: <span className="font-bold text-neutral-900">{qrSnap.upi_id}</span>
                        </p>
                      )}
                      {!isPaid && qrSnap?.upi_uri && (
                        <div className="pt-1 print:hidden">
                          <a
                            href={qrSnap.upi_uri}
                            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1.5"
                          >
                            <Smartphone className="w-4 h-4" />
                            Pay Now · {formatRupees(bill.total)}
                          </a>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs font-medium text-neutral-700">
                      Scan this QR using PhonePe, Google Pay, Paytm, or BHIM and pay{' '}
                      <span className="font-bold text-neutral-900">
                        {formatRupees(bill.total)}
                      </span>
                      .
                    </p>
                  )}
                  <p className="text-[11px] text-neutral-500">
                    PhonePe · Google Pay · Paytm · BHIM
                  </p>
                </div>
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
    </div>
  );
};
