/**
 * Shared NPCI UPI Payment URI & QR Payload Utilities
 * Supports both Mode 1 (Uploaded Static Restaurant QR) and Mode 2 (Dynamic Exact-Amount UPI QR).
 */

import type { PaymentMode, PaymentQrSnapshot, PaymentSettings } from '../types/restaurant.ts';

export type { PaymentMode, PaymentQrSnapshot, PaymentSettings };

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  id: 'payment',
  payment_mode: 'uploaded_qr',
  upi_id: '',
  merchant_name: 'RikZen Fast Food',
  qr_image_url: '',
};

/**
 * Validates standard Indian UPI VPA format (e.g. rikzenfastfood@okaxis, 9876543210@ybl, merchant.shop@icici).
 */
export function isValidUpiId(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 5 || trimmed.length > 120) return false;
  return /^[a-zA-Z0-9._-]{2,80}@[a-zA-Z0-9.-]{2,64}$/.test(trimmed);
}

/**
 * Parses a decoded `upi://pay?...` QR string (from PhonePe, GPay, Paytm, BHIM, BharatPe, etc.)
 * to extract the restaurant's UPI ID (`pa`) and merchant name (`pn`).
 */
export function parseUpiQrPayload(rawText: string): {
  upiId: string;
  merchantName: string;
} | null {
  const text = rawText.trim();
  if (!text) return null;

  if (isValidUpiId(text)) {
    return { upiId: text, merchantName: '' };
  }

  if (text.toLowerCase().startsWith('upi://pay')) {
    try {
      const queryIndex = text.indexOf('?');
      if (queryIndex === -1) return null;
      const params = new URLSearchParams(text.slice(queryIndex + 1));
      const pa = (params.get('pa') || '').trim();
      const pn = (params.get('pn') || '').trim();
      if (isValidUpiId(pa)) {
        return {
          upiId: pa,
          merchantName: pn.slice(0, 80),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Builds a standards-compliant NPCI dynamic-amount UPI payment URI.
 * Pre-fills the exact server-verified bill total (`am`) in PhonePe, Google Pay, Paytm, and BHIM.
 */
export function buildDynamicUpiUri(params: {
  upiId: string;
  merchantName: string;
  amount: number;
  orderCode: string;
  tableNumber?: number;
}): string {
  const cleanUpi = params.upiId.trim();
  if (!isValidUpiId(cleanUpi)) return '';

  const numericAmount = Number(params.amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 100000) {
    return '';
  }

  const cleanName = (params.merchantName || 'RikZen Fast Food').trim().slice(0, 80);
  const cleanCode = (params.orderCode || 'ORDER')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 24);
  const formattedAmount = numericAmount.toFixed(2);
  const note = params.tableNumber
    ? `RikZen Bill ${cleanCode} Table ${params.tableNumber}`
    : `RikZen Bill ${cleanCode}`;

  const query = new URLSearchParams({
    pa: cleanUpi,
    pn: cleanName,
    am: formattedAmount,
    cu: 'INR',
    tn: note,
    tr: cleanCode,
  });

  return `upi://pay?${query.toString()}`;
}

/**
 * Resolves the effective payment QR snapshot for a newly generated bill based on the current
 * restaurant PaymentSettings, preserving an immutable snapshot so old bills keep their original QR.
 */
export function createPaymentQrSnapshot(params: {
  settings: PaymentSettings;
  amount: number;
  orderCode: string;
  tableNumber?: number;
}): PaymentQrSnapshot {
  const merchantName = (params.settings.merchant_name || 'RikZen Fast Food').trim().slice(0, 80);
  const cleanUpi = isValidUpiId(params.settings.upi_id || '') ? params.settings.upi_id.trim() : '';
  const qrImageUrl = (params.settings.qr_image_url || '').trim().slice(0, 500);

  const requestedMode: PaymentMode =
    params.settings.payment_mode === 'dynamic_upi' ? 'dynamic_upi' : 'uploaded_qr';

  // Use Dynamic UPI QR when mode is dynamic_upi and UPI ID is valid (or if no uploaded QR exists)
  if (requestedMode === 'dynamic_upi' && cleanUpi) {
    const upiUri = buildDynamicUpiUri({
      upiId: cleanUpi,
      merchantName,
      amount: params.amount,
      orderCode: params.orderCode,
      tableNumber: params.tableNumber,
    });
    return {
      mode: 'dynamic_upi',
      merchant_name: merchantName,
      upi_id: cleanUpi,
      qr_image_url: '',
      upi_uri: upiUri,
      captured_at: new Date().toISOString(),
    };
  }

  // Mode 1: Uploaded Static QR (never altered, never falsely claims pre-filled amount)
  if (qrImageUrl) {
    return {
      mode: 'uploaded_qr',
      merchant_name: merchantName,
      upi_id: cleanUpi,
      qr_image_url: qrImageUrl,
      upi_uri: '',
      captured_at: new Date().toISOString(),
    };
  }

  // Fallback to dynamic UPI if admin saved a UPI ID even while mode was uploaded_qr with no image
  if (cleanUpi) {
    const upiUri = buildDynamicUpiUri({
      upiId: cleanUpi,
      merchantName,
      amount: params.amount,
      orderCode: params.orderCode,
      tableNumber: params.tableNumber,
    });
    return {
      mode: 'dynamic_upi',
      merchant_name: merchantName,
      upi_id: cleanUpi,
      qr_image_url: '',
      upi_uri: upiUri,
      captured_at: new Date().toISOString(),
    };
  }

  return {
    mode: requestedMode,
    merchant_name: merchantName,
    upi_id: '',
    qr_image_url: '',
    upi_uri: '',
    captured_at: new Date().toISOString(),
  };
}
