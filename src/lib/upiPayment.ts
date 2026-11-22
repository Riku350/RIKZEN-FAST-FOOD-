/**
 * Shared NPCI UPI Payment URI & QR Payload Utilities
 * Used on both backend (authoritative PDF bill generation) and frontend (live bill preview & QR screenshot decoding).
 */

export interface PaymentSettings {
  id: 'payment';
  upi_id: string;
  merchant_name: string;
  qr_image_url: string;
  updated_at?: unknown;
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  id: 'payment',
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

  // Direct VPA text
  if (isValidUpiId(text)) {
    return { upiId: text, merchantName: '' };
  }

  // Standard UPI URI: upi://pay?pa=...&pn=...
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
  const cleanCode = (params.orderCode || 'ORDER').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
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
