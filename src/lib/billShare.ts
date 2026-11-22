import type { OrderRecord } from '../types/restaurant';
import { generateClientBillPdfBlob } from './clientPdfBill';
import { ensureOrderPdfGenerated, formatRupees, getOrderBillFilename } from './orderService';

export interface ShareableBillSummary {
  order_code: string;
  table_number: number;
  customer_name: string;
  total: number;
  public_bill_id?: string;
  pdf_url?: string;
  filename?: string;
}

export interface ShareBillOutcome {
  method: 'native-sheet' | 'native-pdf' | 'copied' | 'cancelled';
  message: string;
  url: string;
}

/**
 * Returns the website-native public bill URL (`/bill/{publicBillId}`).
 */
export function getPublicBillUrl(publicBillId?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (publicBillId && publicBillId.trim()) {
    return `${origin}/bill/${encodeURIComponent(publicBillId.trim())}`;
  }
  return origin ? `${origin}/menu` : '/menu';
}

export function buildBillShareText(bill: ShareableBillSummary): string {
  return [
    `RikZen Fast Food — Bill #${bill.order_code}`,
    `Customer: ${bill.customer_name || 'Guest'} • Table ${bill.table_number}`,
    `Total: ${formatRupees(bill.total)}`,
    'View your bill & pay easily using the link below:',
  ].join('\n');
}

export async function copyBillLinkToClipboard(url: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Website-Native Share Bill (Android / iOS / Mobile / Desktop):
 * Uses `navigator.share({ title, text, url })` when supported, and falls back cleanly
 * to copying the public bill link without ever throwing an unsupported error.
 */
export async function shareBillNative(bill: ShareableBillSummary): Promise<ShareBillOutcome> {
  const url = getPublicBillUrl(bill.public_bill_id);
  const title = `RikZen Fast Food Bill #${bill.order_code}`;
  const text = buildBillShareText(bill);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return {
        method: 'native-sheet',
        message: 'Bill shared.',
        url,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          method: 'cancelled',
          message: 'Share cancelled.',
          url,
        };
      }
      // Fall through cleanly to clipboard copy
    }
  }

  const copied = await copyBillLinkToClipboard(url);
  return {
    method: 'copied',
    message: copied ? 'Bill link copied to clipboard.' : 'Bill link is ready to copy.',
    url,
  };
}

/**
 * Website-Native Share PDF File:
 * Fetches the verified PDF binary (or generates it client-side on static hosts), wraps it as a real `File`,
 * and invokes `navigator.share({ files: [pdfFile], title, text })` when supported by the device.
 * Automatically falls back to `shareBillNative` (link share / copy) on unsupported browsers.
 */
export async function shareBillPdfNative(
  source: OrderRecord | ShareableBillSummary,
): Promise<ShareBillOutcome> {
  const defaultBillId = source.public_bill_id || ('id' in source ? source.id : '');
  const fallbackUrl = getPublicBillUrl(defaultBillId);

  try {
    let pdfUrl = source.pdf_url || '';
    let filename =
      'filename' in source && source.filename
        ? source.filename
        : 'order_number' in source
          ? getOrderBillFilename(source)
          : `RikZen-Fast-Food-Bill-${source.order_code}.pdf`;
    let publicBillId = defaultBillId;

    if (!pdfUrl && 'id' in source && source.id) {
      const generated = await ensureOrderPdfGenerated(source, { persistIfOwner: true });
      pdfUrl = generated.pdf_url;
      filename = generated.filename;
      publicBillId = generated.public_bill_id || publicBillId;
    }

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function'
    ) {
      let pdfBlob: Blob | null = null;
      if (pdfUrl) {
        const resp = await fetch(`${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}download=1`, {
          cache: 'no-store',
        });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const header = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
          if (buf.byteLength >= 512 && header === '%PDF-') {
            pdfBlob = new Blob([buf], { type: 'application/pdf' });
          }
        }
      }
      if (!pdfBlob && 'items' in source && Array.isArray(source.items)) {
        pdfBlob = await generateClientBillPdfBlob(
          source,
          source.payment_qr_snapshot || null,
        );
      }

      if (pdfBlob) {
        const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
        if (navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            title: `RikZen Fast Food Bill #${source.order_code}`,
            text: buildBillShareText({ ...source, public_bill_id: publicBillId }),
            files: [pdfFile],
          });
          return {
            method: 'native-pdf',
            message: 'PDF bill shared.',
            url: getPublicBillUrl(publicBillId),
          };
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        method: 'cancelled',
        message: 'Share cancelled.',
        url: fallbackUrl,
      };
    }
    // Automatically fall back to link share / copy
  }

  return shareBillNative({ ...source, public_bill_id: defaultBillId });
}
