import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { CANONICAL_MENU_ITEMS, CANONICAL_OFFERS, TABLE_NUMBERS } from '../data/menuCatalog';
import {
  BillStatus,
  CartItem,
  CustomerDetails,
  GeneratedBillResult,
  MenuCategoryId,
  MenuItem,
  OfferRecord,
  OrderRecord,
  OrderStatus,
  TableRecord,
  TableStatus,
  VerifiedOrderQuote,
  WhatsAppDeliveryStatus,
} from '../types/restaurant';
import { auth, BOOTSTRAPPED_OWNER_EMAIL, db } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';

const SESSION_KEY = 'rikzen_customer_session_id';
const CUSTOMER_DETAILS_KEY = 'rikzen_customer_details_v1';
const ACTIVE_ORDER_PREFIX = 'rikzen_active_order_table_';

export function getOrCreateCustomerSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{16,128}$/.test(existing)) {
      return existing;
    }
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const sessionId = `sess_${hex}`;
    localStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  } catch {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function getSavedCustomerDetails(): CustomerDetails {
  try {
    const raw = localStorage.getItem(CUSTOMER_DETAILS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomerDetails>;
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        mobileDigits: typeof parsed.mobileDigits === 'string' ? parsed.mobileDigits : '',
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      };
    }
  } catch {
    // Ignore parse/storage errors
  }
  return { name: '', mobileDigits: '', notes: '' };
}

export function saveCustomerDetailsLocally(details: CustomerDetails): void {
  try {
    localStorage.setItem(CUSTOMER_DETAILS_KEY, JSON.stringify(details));
  } catch {
    // Ignore storage quota errors
  }
}

export function isValidIndianMobileDigits(digits: string): boolean {
  return /^[6-9][0-9]{9}$/.test(digits.trim());
}

export function formatIndianMobileDisplay(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return mobile || 'Not provided';
}

export function getOrderBillFilename(order: Pick<OrderRecord, 'order_code' | 'order_number'>): string {
  const code = (order.order_code || `RK${order.order_number || 1000}`).toUpperCase();
  return `RikZen-Fast-Food-Bill-${code}.pdf`;
}

export function getStoredOrderIdForTable(tableNumber: number): string | null {
  try {
    const id = localStorage.getItem(`${ACTIVE_ORDER_PREFIX}${tableNumber}`);
    if (id && /^ord_[a-zA-Z0-9_-]{20,}$/.test(id)) {
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredOrderIdForTable(tableNumber: number, orderId: string | null): void {
  try {
    const key = `${ACTIVE_ORDER_PREFIX}${tableNumber}`;
    if (orderId) {
      localStorage.setItem(key, orderId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

export function timestampToDate(ts: unknown): Date {
  if (ts instanceof Timestamp) {
    return ts.toDate();
  }
  if (ts && typeof ts === 'object' && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === 'string' && ts.trim()) {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (ts instanceof Date) {
    return ts;
  }
  return new Date();
}

export function formatRelativeTime(ts: unknown, nowMs: number = Date.now()): string {
  const date = timestampToDate(ts);
  const diffSeconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (diffSeconds < 30) return 'Just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMins = Math.floor(diffSeconds / 60);
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'min' : 'mins'} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hr' : 'hrs'} ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatOrderDate(ts: unknown): { date: string; time: string } {
  const d = timestampToDate(ts);
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function getTableQrUrl(tableNumber: number): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/menu?table=${tableNumber}`;
}

export function normalizeOrderRecord(raw: Partial<OrderRecord>): OrderRecord {
  const orderNumber = Number(raw.order_number || 1000);
  const orderCode = (raw.order_code || `RK${orderNumber}`).toUpperCase();
  const whatsappStatus: WhatsAppDeliveryStatus = raw.whatsapp_status || raw.send_status || 'not_sent';
  const sendStatus: WhatsAppDeliveryStatus = raw.send_status || whatsappStatus;

  let billStatus: BillStatus = raw.bill_status || 'not_generated';
  if (!raw.bill_status) {
    if (whatsappStatus === 'sent') billStatus = 'sent';
    else if (whatsappStatus === 'sending') billStatus = 'sending';
    else if (whatsappStatus === 'retrying') billStatus = 'retrying';
    else if (whatsappStatus === 'failed') billStatus = 'failed';
    else if (raw.pdf_ready) billStatus = 'generated';
  }

  return {
    id: raw.id || '',
    order_number: orderNumber,
    order_code: orderCode,
    table_id: raw.table_id || `table_${raw.table_number || 1}`,
    table_number: Number(raw.table_number || 1),
    customer_name: raw.customer_name || 'Walk-in Guest',
    customer_mobile: raw.customer_mobile || '',
    items: Array.isArray(raw.items)
      ? raw.items.map((line) => ({
          menu_item_id: line.menu_item_id,
          name: line.name,
          regular_price: line.regular_price ?? line.unit_price,
          unit_price: line.unit_price,
          quantity: line.quantity,
          line_total: line.line_total,
        }))
      : [],
    item_count: Number(raw.item_count || 0),
    subtotal: Number(raw.subtotal || 0),
    discount: typeof raw.discount === 'number' ? raw.discount : 0,
    total: Number(raw.total || 0),
    status: (raw.status || 'pending') as OrderStatus,
    pdf_ready: Boolean(raw.pdf_ready ?? (billStatus === 'generated' || billStatus === 'sent')),
    bill_status: billStatus,
    pdf_url: typeof raw.pdf_url === 'string' ? raw.pdf_url : '',
    pdf_path: typeof raw.pdf_path === 'string' ? raw.pdf_path : '',
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
    sent_at: typeof raw.sent_at === 'string' ? raw.sent_at : '',
    send_status: sendStatus,
    whatsapp_status: whatsappStatus,
    whatsapp_error: typeof raw.whatsapp_error === 'string' ? raw.whatsapp_error : '',
    customer_session_id: raw.customer_session_id || '',
    server_signature: raw.server_signature || '',
    notes: raw.notes || '',
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

async function getOwnerAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Owner sign-in required.');
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function getOptionalOwnerAuthHeader(): Promise<Record<string, string>> {
  try {
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Safely parses an API JSON response so HTML proxy pages or unexpected responses
 * never trigger raw `Unexpected token '<'` syntax crashes in the UI.
 */
async function safeReadJson<T>(
  res: Response,
  contextLabel: string,
): Promise<{ data: T | null; errorMessage: string | null }> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  if (!rawText.trim()) {
    return { data: null, errorMessage: `${contextLabel} returned an empty response (HTTP ${res.status}).` };
  }
  if (!contentType.includes('application/json') && rawText.trim().startsWith('<')) {
    console.error(`[RikZen API Non-JSON Response] ${contextLabel}`, {
      status: res.status,
      contentType,
      snippet: rawText.slice(0, 200),
    });
    return {
      data: null,
      errorMessage: `API endpoint returned an unexpected HTML page (HTTP ${res.status}). Please retry or restart the server.`,
    };
  }
  try {
    return { data: JSON.parse(rawText) as T, errorMessage: null };
  } catch (err) {
    console.error(`[RikZen API JSON Parse Error] ${contextLabel}`, {
      status: res.status,
      error: err,
      snippet: rawText.slice(0, 200),
    });
    return {
      data: null,
      errorMessage: `${contextLabel} returned an invalid response (HTTP ${res.status}).`,
    };
  }
}

function buildOrderPayloadForServer(order: OrderRecord) {
  return {
    id: order.id,
    order_number: order.order_number,
    order_code: (order.order_code || `RK${order.order_number}`).toUpperCase(),
    table_id: order.table_id,
    table_number: order.table_number,
    customer_name: order.customer_name || 'Guest',
    customer_mobile: order.customer_mobile || '',
    items: order.items.map((line) => ({
      menu_item_id: line.menu_item_id,
      name: line.name,
      regular_price: line.regular_price ?? line.unit_price,
      unit_price: line.unit_price,
      quantity: line.quantity,
      line_total: line.line_total,
    })),
    subtotal: order.subtotal,
    discount: order.discount ?? 0,
    total: order.total,
    customer_session_id: order.customer_session_id,
    server_signature: order.server_signature,
    notes: order.notes || '',
    created_at_iso: timestampToDate(order.created_at).toISOString(),
  };
}

/**
 * Syncs live Firestore menu items & offers to the Express backend so server-side
 * order pricing always matches the owner's latest prices and offers.
 */
export async function syncCatalogToServer(
  items: MenuItem[],
  offers: OfferRecord[],
): Promise<void> {
  try {
    const headers = await getOwnerAuthHeader();
    await fetch('/api/catalog/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ items, offers }),
    });
  } catch {
    // Non-blocking background sync
  }
}

export async function fetchOwnerConfigStatus(): Promise<{ whatsappConfigured: boolean }> {
  try {
    const headers = await getOwnerAuthHeader();
    const res = await fetch('/api/owner/config-status', { headers });
    if (!res.ok) return { whatsappConfigured: false };
    const { data } = await safeReadJson<{ whatsappConfigured?: boolean }>(
      res,
      'Owner config status',
    );
    return { whatsappConfigured: Boolean(data?.whatsappConfigured) };
  } catch {
    return { whatsappConfigured: false };
  }
}

export async function uploadDishImageToServer(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please choose a JPEG, PNG, or WebP food photo.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Food photo must be smaller than 2 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected photo.'));
    reader.readAsDataURL(file);
  });

  const headers = await getOwnerAuthHeader();
  const res = await fetch('/api/owner/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ dataUrl }),
  });

  const { data: json, errorMessage } = await safeReadJson<{ url?: string; error?: string }>(
    res,
    'Image upload',
  );
  if (!res.ok || !json?.url) {
    throw new Error(json?.error || errorMessage || 'Could not upload food image.');
  }
  return json.url;
}

/**
 * Sends table, customer details, and cart items to Express backend for authoritative
 * server-side price, offer discount, HMAC signing, AND immediate real PDF generation/storage.
 */
export async function verifyOrderOnServer(
  tableNumber: number,
  cartItems: CartItem[],
  customer: CustomerDetails,
): Promise<VerifiedOrderQuote> {
  const customerSessionId = getOrCreateCustomerSessionId();
  const payload = {
    tableNumber,
    customerName: customer.name.trim(),
    customerMobile: `+91${customer.mobileDigits.trim()}`,
    customerSessionId,
    notes: customer.notes.trim().slice(0, 200),
    items: cartItems.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      quantity: entry.quantity,
    })),
  };

  const response = await fetch('/api/orders/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const { data, errorMessage } = await safeReadJson<VerifiedOrderQuote & { error?: string }>(
    response,
    'Order verification',
  );
  if (!response.ok || !data) {
    throw new Error(data?.error || errorMessage || 'Could not validate order with server.');
  }
  return data;
}

/**
 * Persists a server-verified order (including its generated PDF URL, storage path, and bill status)
 * into Firestore so both Customer and Owner Dashboard see it live and after refresh.
 */
export async function createConfirmedOrder(quote: VerifiedOrderQuote): Promise<string> {
  const path = `orders/${quote.id}`;
  try {
    await setDoc(doc(db, 'orders', quote.id), {
      id: quote.id,
      order_number: quote.order_number,
      order_code: quote.order_code,
      table_id: quote.table_id,
      table_number: quote.table_number,
      customer_name: quote.customer_name.slice(0, 80),
      customer_mobile: quote.customer_mobile,
      items: quote.items,
      item_count: quote.item_count,
      subtotal: quote.subtotal,
      discount: quote.discount,
      total: quote.total,
      status: 'pending',
      pdf_ready: Boolean(quote.pdf_ready),
      bill_status: quote.bill_status || 'generated',
      pdf_url: quote.pdf_url || '',
      pdf_path: quote.pdf_path || '',
      generated_at: quote.generated_at || '',
      sent_at: '',
      send_status: 'not_sent',
      whatsapp_status: 'not_sent',
      whatsapp_error: '',
      customer_session_id: quote.customer_session_id,
      server_signature: quote.server_signature,
      notes: quote.notes.slice(0, 200),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    setStoredOrderIdForTable(quote.table_number, quote.id);
    return quote.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Unified PDF Bill Generation & Verification Helper.
 * Guarantees the actual `.pdf` exists in `/bills/{orderId}/RikZen-Fast-Food-Bill-{orderCode}.pdf`
 * on the backend server and syncs `pdf_url`, `pdf_path`, `generated_at`, `bill_status` to Firestore
 * when signed in as the verified owner.
 */
export async function ensureOrderPdfGenerated(
  order: OrderRecord,
  options: { forceRegenerate?: boolean; persistIfOwner?: boolean } = {},
): Promise<GeneratedBillResult> {
  const authHeaders = await getOptionalOwnerAuthHeader();
  const isOwnerSession = Boolean(authHeaders.Authorization && options.persistIfOwner !== false);

  if (isOwnerSession && (order.bill_status === 'not_generated' || options.forceRegenerate)) {
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        bill_status: 'generating',
        updated_at: serverTimestamp(),
      });
    } catch {
      // Continue generating even if intermediate status update fails
    }
  }

  let res: Response;
  try {
    res = await fetch('/api/bills/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        order: buildOrderPayloadForServer(order),
        forceRegenerate: Boolean(options.forceRegenerate),
      }),
    });
  } catch (networkErr) {
    console.error('[RikZen PDF Generate Network Error]', networkErr);
    throw new Error('Network error while generating PDF bill. Please check your connection and try again.');
  }

  const { data: parsedJson, errorMessage: parseErrMsg } = await safeReadJson<
    Partial<GeneratedBillResult> & { error?: string }
  >(res, 'PDF bill generation');
  const json = parsedJson || {};

  if (!res.ok || !json.ok || !json.pdf_url || !json.pdf_path) {
    const errMsg = json.error || parseErrMsg || `Bill generation failed (HTTP ${res.status}).`;
    console.error('[RikZen PDF Generate Error]', { status: res.status, errMsg, orderId: order.id });
    if (isOwnerSession) {
      try {
        await updateDoc(doc(db, 'orders', order.id), {
          bill_status: 'failed',
          updated_at: serverTimestamp(),
        });
      } catch {
        // Ignore secondary update failure
      }
    }
    throw new Error(errMsg);
  }

  const result: GeneratedBillResult = {
    ok: true,
    order_id: json.order_id || order.id,
    order_code: json.order_code || order.order_code,
    filename: json.filename || getOrderBillFilename(order),
    bill_status: json.bill_status || 'generated',
    pdf_url: json.pdf_url,
    pdf_path: json.pdf_path,
    generated_at: json.generated_at || new Date().toISOString(),
    size_bytes: Number(json.size_bytes || 0),
  };

  if (
    isOwnerSession &&
    (order.pdf_url !== result.pdf_url ||
      order.pdf_path !== result.pdf_path ||
      !order.pdf_ready ||
      order.bill_status === 'not_generated' ||
      order.bill_status === 'generating')
  ) {
    try {
      const preservedBillStatus: BillStatus =
        order.send_status === 'sent' || order.whatsapp_status === 'sent'
          ? 'sent'
          : order.send_status === 'failed' || order.whatsapp_status === 'failed'
            ? 'failed'
            : 'generated';
      await updateDoc(doc(db, 'orders', order.id), {
        pdf_ready: true,
        bill_status: preservedBillStatus,
        pdf_url: result.pdf_url,
        pdf_path: result.pdf_path,
        generated_at: result.generated_at,
        updated_at: serverTimestamp(),
      });
    } catch (syncErr) {
      console.error('[RikZen PDF Metadata Sync Warning]', syncErr);
    }
  }

  return result;
}

/**
 * Verifies the real `.pdf` binary from server storage and downloads it directly
 * to the user's Downloads folder as `RikZen-Fast-Food-Bill-RK1024.pdf`.
 * Works reliably on Chrome Desktop, Android Chrome, and mobile browsers.
 */
export async function downloadOrderBillPdf(
  order: OrderRecord,
): Promise<GeneratedBillResult> {
  try {
    // 1. Ensure PDF exists on backend storage
    const bill = await ensureOrderPdfGenerated(order, { persistIfOwner: true });

    // 2. Fetch actual PDF binary bytes from verified file URL
    const downloadUrl = `${bill.pdf_url}&download=1`;
    const response = await fetch(downloadUrl, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      const { data: errJson, errorMessage } = await safeReadJson<{ error?: string }>(
        response,
        'PDF download',
      );
      throw new Error(
        errJson?.error || errorMessage || `Failed to download PDF bill (HTTP ${response.status}).`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/pdf')) {
      throw new Error('Server did not return a valid PDF document.');
    }

    const arrayBuffer = await response.arrayBuffer();
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
    const pdfMagic = String.fromCharCode(...headerBytes);
    if (arrayBuffer.byteLength < 512 || pdfMagic !== '%PDF-') {
      throw new Error('Downloaded bill file was empty or corrupted. Please try again.');
    }

    // 3. Trigger real browser file download with proper filename
    const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(pdfBlob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = bill.filename;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Keep blob URL alive for 60s so mobile Chrome finishes saving the file
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    return bill;
  } catch (err) {
    console.error('[RikZen PDF Download Error]', { orderId: order.id, error: err });
    throw err instanceof Error ? err : new Error('Download failed. Please try again.');
  }
}

/**
 * Owner action: Generates & downloads a real server-side Sales Report PDF
 * (Daily / Weekly / Monthly / Custom) counting ONLY completed orders.
 */
export async function downloadSalesReportPdf(params: {
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  periodLabel: string;
  filename: string;
  orders: OrderRecord[];
}): Promise<string> {
  const headers = await getOwnerAuthHeader();
  const payloadOrders = params.orders
    .filter((o) => o.status === 'completed')
    .map((o) => ({
      order_code: (o.order_code || `RK${o.order_number}`).toUpperCase(),
      customer_name: o.customer_name || 'Guest',
      table_number: o.table_number,
      total: o.total,
      status: o.status,
      created_at_iso: timestampToDate(o.created_at).toISOString(),
    }));

  const response = await fetch('/api/reports/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      reportType: params.reportType,
      periodLabel: params.periodLabel,
      filename: params.filename,
      orders: payloadOrders,
    }),
  });

  if (!response.ok) {
    const { data: errJson, errorMessage } = await safeReadJson<{ error?: string }>(
      response,
      'Sales report PDF',
    );
    throw new Error(
      errJson?.error || errorMessage || `Failed to generate report PDF (HTTP ${response.status}).`,
    );
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) {
    throw new Error('Server did not return a valid PDF report.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
  const pdfMagic = String.fromCharCode(...headerBytes);
  if (arrayBuffer.byteLength < 512 || pdfMagic !== '%PDF-') {
    throw new Error('Generated sales report PDF was empty or invalid.');
  }

  const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(pdfBlob);

  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = params.filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  return params.filename;
}

/**
 * Owner action: Sends the stored PDF bill via configured WhatsApp Business Cloud API.
 * Maintains real Firestore statuses: `sending` / `retrying` -> `sent` or `failed`.
 * Retry reuses the exact same order ID and PDF storage path without creating duplicates.
 */
export async function ownerSendWhatsAppBill(
  order: OrderRecord,
): Promise<{
  delivered: boolean;
  status: WhatsAppDeliveryStatus;
  billStatus: BillStatus;
  code?: string;
  whatsappNotConfigured?: boolean;
  error?: string;
}> {
  const orderPath = `orders/${order.id}`;
  const isRetry =
    order.send_status === 'failed' ||
    order.whatsapp_status === 'failed' ||
    order.bill_status === 'failed';
  const activeState: WhatsAppDeliveryStatus = isRetry ? 'retrying' : 'sending';

  try {
    await updateDoc(doc(db, 'orders', order.id), {
      bill_status: activeState,
      send_status: activeState,
      whatsapp_status: activeState,
      whatsapp_error: '',
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, orderPath);
  }

  try {
    const headers = await getOwnerAuthHeader();
    const res = await fetch('/api/bills/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        order: buildOrderPayloadForServer(order),
      }),
    });

    const { data: parsedJson, errorMessage: parseErrMsg } = await safeReadJson<{
      delivered?: boolean;
      code?: string;
      status?: WhatsAppDeliveryStatus;
      bill_status?: BillStatus;
      sent_at?: string;
      pdf_url?: string;
      pdf_path?: string;
      generated_at?: string;
      error?: string;
    }>(res, 'WhatsApp bill delivery');

    const json = parsedJson || {};

    if (res.ok && json.delivered) {
      const sentAt = json.sent_at || new Date().toISOString();
      await updateDoc(doc(db, 'orders', order.id), {
        pdf_ready: true,
        bill_status: 'sent',
        send_status: 'sent',
        whatsapp_status: 'sent',
        whatsapp_error: '',
        sent_at: sentAt,
        ...(json.pdf_url ? { pdf_url: json.pdf_url } : {}),
        ...(json.pdf_path ? { pdf_path: json.pdf_path } : {}),
        ...(json.generated_at ? { generated_at: json.generated_at } : {}),
        updated_at: serverTimestamp(),
      });
      return { delivered: true, status: 'sent', billStatus: 'sent' };
    }

    const isNotConfigured = json.code === 'WHATSAPP_NOT_CONFIGURED';
    const errText = (
      json.error ||
      parseErrMsg ||
      `WhatsApp delivery failed (HTTP ${res.status}).`
    ).slice(0, 240);
    console.error('[RikZen WhatsApp Send Failed]', {
      orderId: order.id,
      status: res.status,
      code: json.code,
      errText,
    });
    await updateDoc(doc(db, 'orders', order.id), {
      pdf_ready: Boolean(json.pdf_url || order.pdf_ready),
      bill_status: 'failed',
      send_status: 'failed',
      whatsapp_status: 'failed',
      whatsapp_error: errText,
      ...(json.pdf_url ? { pdf_url: json.pdf_url } : {}),
      ...(json.pdf_path ? { pdf_path: json.pdf_path } : {}),
      ...(json.generated_at ? { generated_at: json.generated_at } : {}),
      updated_at: serverTimestamp(),
    });
    return {
      delivered: false,
      status: 'failed',
      billStatus: 'failed',
      code: json.code,
      whatsappNotConfigured: isNotConfigured,
      error: errText,
    };
  } catch (err) {
    const errText = (err instanceof Error ? err.message : 'WhatsApp delivery error.').slice(0, 240);
    console.error('[RikZen WhatsApp Send Exception]', { orderId: order.id, error: err });
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        bill_status: 'failed',
        send_status: 'failed',
        whatsapp_status: 'failed',
        whatsapp_error: errText,
        updated_at: serverTimestamp(),
      });
    } catch {
      // Ignore secondary update error
    }
    return { delivered: false, status: 'failed', billStatus: 'failed', error: errText };
  }
}

/**
 * Customer real-time listener for their own order document only.
 */
export function subscribeToOrder(
  orderId: string,
  onOrder: (order: OrderRecord | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const path = `orders/${orderId}`;
  return onSnapshot(
    doc(db, 'orders', orderId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onOrder(null);
        return;
      }
      onOrder(normalizeOrderRecord(snapshot.data() as Partial<OrderRecord>));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
}

/**
 * Customer action: Request Bill on an accepted / preparing / ready order.
 */
export async function requestOrderBill(orderId: string): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'bill_requested',
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Public menu catalog real-time subscription with canonical fallback.
 */
export function subscribeToMenuItems(onItems: (items: MenuItem[]) => void): Unsubscribe {
  const path = 'menu_items';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      if (snapshot.empty) {
        onItems(CANONICAL_MENU_ITEMS);
        return;
      }
      const docs = snapshot.docs.map((d) => {
        const raw = d.data() as Partial<MenuItem>;
        return {
          ...raw,
          offer_price: typeof raw.offer_price === 'number' ? raw.offer_price : 0,
        } as MenuItem;
      });
      const orderIndex = new Map(CANONICAL_MENU_ITEMS.map((item, idx) => [item.id, idx]));
      docs.sort((a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999));
      onItems(docs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onItems(CANONICAL_MENU_ITEMS);
      }
    },
  );
}

/**
 * Public offers real-time subscription with canonical fallback.
 */
export function subscribeToOffers(onOffers: (offers: OfferRecord[]) => void): Unsubscribe {
  const path = 'offers';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      if (snapshot.empty) {
        onOffers(CANONICAL_OFFERS);
        return;
      }
      const docs = snapshot.docs.map((d) => d.data() as OfferRecord);
      onOffers(docs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onOffers(CANONICAL_OFFERS);
      }
    },
  );
}

/**
 * Verify if signed-in user is authorized RikZen owner/admin.
 */
export async function checkIsOwnerAccount(user: User): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (user.email?.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL.toLowerCase()) {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * Seeds Firestore tables (1..6), menu items (with offer_price), offers, and owner profile on first login.
 */
export async function seedOwnerShopDataIfNeeded(ownerUser: User): Promise<void> {
  // 1. Owner profile
  const userPath = `users/${ownerUser.uid}`;
  try {
    const userRef = doc(db, 'users', ownerUser.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: ownerUser.uid,
        email: (ownerUser.email || BOOTSTRAPPED_OWNER_EMAIL).slice(0, 160),
        display_name: (ownerUser.displayName || 'RikZen Owner').slice(0, 80),
        role: 'owner',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // 2. 6 Tables
  try {
    const existingTables = await getDocs(collection(db, 'tables'));
    if (existingTables.size < 6) {
      const existingIds = new Set(existingTables.docs.map((d) => d.id));
      const batch = writeBatch(db);
      for (const n of TABLE_NUMBERS) {
        const tableId = `table_${n}`;
        if (!existingIds.has(tableId)) {
          batch.set(doc(db, 'tables', tableId), {
            id: tableId,
            table_number: n,
            qr_code: getTableQrUrl(n).slice(0, 300),
            status: 'available',
            active_order_id: '',
            updated_at: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'tables');
  }

  // 3. Menu Items (also migrates legacy docs missing offer_price)
  try {
    const existingMenu = await getDocs(collection(db, 'menu_items'));
    if (existingMenu.empty) {
      const batch = writeBatch(db);
      for (const item of CANONICAL_MENU_ITEMS) {
        batch.set(doc(db, 'menu_items', item.id), {
          id: item.id,
          name: item.name.slice(0, 80),
          category: item.category,
          description: item.description.slice(0, 220),
          price: item.price,
          offer_price: item.offer_price,
          image: item.image.slice(0, 500),
          available: item.available,
          is_veg: item.is_veg,
          featured: item.featured,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }
      await batch.commit();
    } else {
      const batch = writeBatch(db);
      let needsMigration = false;
      for (const docSnap of existingMenu.docs) {
        const data = docSnap.data();
        if (typeof data.offer_price !== 'number') {
          needsMigration = true;
          const canonical = CANONICAL_MENU_ITEMS.find((c) => c.id === docSnap.id);
          batch.set(doc(db, 'menu_items', docSnap.id), {
            id: docSnap.id,
            name: String(data.name || canonical?.name || 'Item').slice(0, 80),
            category: (data.category || canonical?.category || 'special') as MenuCategoryId,
            description: String(data.description || canonical?.description || 'Freshly made').slice(0, 220),
            price: Number(data.price || canonical?.price || 80),
            offer_price: canonical?.offer_price ?? 0,
            image: String(data.image || canonical?.image || '/src/assets/images/food_chicken_roll_1795284803954.jpg').slice(0, 500),
            available: Boolean(data.available ?? true),
            is_veg: Boolean(data.is_veg ?? false),
            featured: Boolean(data.featured ?? false),
            created_at: data.created_at || serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        }
      }
      if (needsMigration) {
        await batch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'menu_items');
  }

  // 4. Offers collection
  try {
    const existingOffers = await getDocs(collection(db, 'offers'));
    if (existingOffers.empty) {
      const batch = writeBatch(db);
      for (const offer of CANONICAL_OFFERS) {
        batch.set(doc(db, 'offers', offer.id), {
          id: offer.id,
          title: offer.title.slice(0, 80),
          description: offer.description.slice(0, 200),
          image: offer.image.slice(0, 500),
          regular_price: offer.regular_price,
          offer_price: offer.offer_price,
          active: offer.active,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'offers');
  }
}

export function subscribeToAllOrders(
  onOrders: (orders: OrderRecord[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const path = 'orders';
  const q = query(collection(db, path), orderBy('created_at', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) =>
        normalizeOrderRecord(d.data() as Partial<OrderRecord>),
      );
      onOrders(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (wrapped instanceof Error) onError(wrapped);
      }
    },
  );
}

export function subscribeToTables(
  onTables: (tables: TableRecord[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const path = 'tables';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as TableRecord)
        .sort((a, b) => a.table_number - b.table_number);
      onTables(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (wrapped instanceof Error) onError(wrapped);
      }
    },
  );
}

function mapOrderStatusToTableStatus(status: OrderStatus): TableStatus {
  switch (status) {
    case 'pending':
    case 'accepted':
      return 'ordering';
    case 'preparing':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'bill_requested':
    case 'bill_ready':
      return 'bill_requested';
    case 'completed':
    case 'rejected':
    default:
      return 'available';
  }
}

export async function ownerUpdateOrderStatus(
  order: OrderRecord,
  nextStatus: OrderStatus,
): Promise<GeneratedBillResult | null> {
  const orderPath = `orders/${order.id}`;
  let generatedBill: GeneratedBillResult | null = null;

  // On accept or bill_ready, guarantee the real stored PDF exists on disk
  if (nextStatus === 'accepted' || nextStatus === 'bill_ready') {
    generatedBill = await ensureOrderPdfGenerated(order, { persistIfOwner: false });
  }

  try {
    const batch = writeBatch(db);
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      pdf_ready: nextStatus !== 'rejected',
      updated_at: serverTimestamp(),
    };

    if (generatedBill) {
      updatePayload.pdf_url = generatedBill.pdf_url;
      updatePayload.pdf_path = generatedBill.pdf_path;
      updatePayload.generated_at = generatedBill.generated_at;
      if (order.send_status !== 'sent' && order.whatsapp_status !== 'sent') {
        updatePayload.bill_status = 'generated';
      }
    }

    batch.update(doc(db, 'orders', order.id), updatePayload);

    const tableId = `table_${order.table_number}`;
    const nextTableStatus = mapOrderStatusToTableStatus(nextStatus);
    const isTerminal = nextStatus === 'completed' || nextStatus === 'rejected';

    batch.set(doc(db, 'tables', tableId), {
      id: tableId,
      table_number: order.table_number,
      qr_code: getTableQrUrl(order.table_number).slice(0, 300),
      status: nextTableStatus,
      active_order_id: isTerminal ? '' : order.id,
      updated_at: serverTimestamp(),
    });

    await batch.commit();
    return generatedBill;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, orderPath);
  }
}

/**
 * Owner CRUD: Add or Edit Menu Item
 */
export async function ownerSaveMenuItem(
  payload: {
    id?: string;
    name: string;
    category: MenuCategoryId;
    description: string;
    price: number;
    offer_price: number;
    image: string;
    available: boolean;
    is_veg: boolean;
    featured: boolean;
    existingCreatedAt?: unknown;
  },
): Promise<string> {
  const isNew = !payload.id;
  const slugBase = payload.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 36);
  const itemId =
    payload.id || `${slugBase || 'item'}_${Math.random().toString(36).slice(2, 8)}`;

  const cleanPrice = Math.max(1, Math.min(20000, Math.round(payload.price)));
  const cleanOffer =
    payload.offer_price > 0 && payload.offer_price < cleanPrice
      ? Math.round(payload.offer_price)
      : 0;

  const path = `menu_items/${itemId}`;
  try {
    await setDoc(doc(db, 'menu_items', itemId), {
      id: itemId,
      name: payload.name.trim().slice(0, 80),
      category: payload.category,
      description: (payload.description.trim() || 'Freshly prepared at RikZen Fast Food.').slice(
        0,
        220,
      ),
      price: cleanPrice,
      offer_price: cleanOffer,
      image: payload.image.trim().slice(0, 500),
      available: Boolean(payload.available),
      is_veg: Boolean(payload.is_veg),
      featured: Boolean(payload.featured),
      created_at: isNew ? serverTimestamp() : payload.existingCreatedAt || serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    return itemId;
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function ownerDeleteMenuItem(itemId: string): Promise<void> {
  const path = `menu_items/${itemId}`;
  try {
    await deleteDoc(doc(db, 'menu_items', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function ownerToggleMenuItemAvailability(item: MenuItem): Promise<void> {
  const path = `menu_items/${item.id}`;
  try {
    await updateDoc(doc(db, 'menu_items', item.id), {
      available: !item.available,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Owner CRUD: Add / Edit / Toggle / Delete Offers
 */
export async function ownerSaveOffer(payload: {
  id?: string;
  title: string;
  description: string;
  image: string;
  regular_price: number;
  offer_price: number;
  active: boolean;
  existingCreatedAt?: unknown;
}): Promise<string> {
  const isNew = !payload.id;
  const slugBase = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  const offerId =
    payload.id || `offer_${slugBase || 'deal'}_${Math.random().toString(36).slice(2, 7)}`;

  const reg = Math.max(2, Math.min(20000, Math.round(payload.regular_price)));
  const off = Math.max(1, Math.min(reg - 1, Math.round(payload.offer_price)));

  const path = `offers/${offerId}`;
  try {
    await setDoc(doc(db, 'offers', offerId), {
      id: offerId,
      title: payload.title.trim().slice(0, 80),
      description: (payload.description.trim() || 'Special RikZen Fast Food offer combo.').slice(
        0,
        200,
      ),
      image: payload.image.trim().slice(0, 500),
      regular_price: reg,
      offer_price: off,
      active: Boolean(payload.active),
      created_at: isNew ? serverTimestamp() : payload.existingCreatedAt || serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    return offerId;
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function ownerToggleOfferActive(offer: OfferRecord): Promise<void> {
  const path = `offers/${offer.id}`;
  try {
    await updateDoc(doc(db, 'offers', offer.id), {
      active: !offer.active,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function ownerDeleteOffer(offerId: string): Promise<void> {
  const path = `offers/${offerId}`;
  try {
    await deleteDoc(doc(db, 'offers', offerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function playKitchenAlertChime(kind: 'order' | 'bill' = 'order'): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = kind === 'bill' ? [659.25, 880, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.28);
    });
  } catch {
    // Ignore autoplay blocks prior to user interaction
  }
}
