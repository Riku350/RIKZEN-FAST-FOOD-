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
  PaymentMode,
  PaymentQrSnapshot,
  PaymentSettings,
  PaymentStatus,
  TableRecord,
  TableStatus,
  VerifiedOrderQuote,
} from '../types/restaurant';
import { auth, BOOTSTRAPPED_OWNER_EMAIL, db } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import {
  generateClientBillPdfBlob,
  generateClientSalesReportPdfBlob,
} from './clientPdfBill';
import {
  createPaymentQrSnapshot,
  DEFAULT_PAYMENT_SETTINGS,
  isValidUpiId,
} from './upiPayment';

const API_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function apiUrl(routePath: string): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${API_BASE}${normalized}`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic 64-char hex fallback if subtle crypto is unavailable in an older context
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4);
}

function isStaticHostMissingEndpoint(
  res: Response,
  parsed: { data: unknown; errorMessage: string | null },
): boolean {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isHtmlFallback =
    !ct.includes('application/json') &&
    Boolean(parsed.errorMessage?.includes('unexpected HTML page'));
  const isEmpty404 =
    (res.status === 404 || res.status === 405) &&
    (!parsed.data || parsed.errorMessage?.includes('empty response'));
  const isNotFoundNonJson = (res.status === 404 || res.status === 405) && !ct.includes('application/json');
  return isHtmlFallback || isEmpty404 || isNotFoundNonJson;
}

const SESSION_KEY = 'rikzen_customer_session_id';
const CUSTOMER_DETAILS_KEY = 'rikzen_customer_details_v1';
const ACTIVE_ORDER_PREFIX = 'rikzen_active_order_table_';
const MENU_CACHE_KEY = 'rikzen_menu_cache_v1';
const OFFERS_CACHE_KEY = 'rikzen_offers_cache_v1';

export function getCachedMenuItems(): MenuItem[] {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MenuItem[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Fallback to canonical catalog
  }
  return CANONICAL_MENU_ITEMS;
}

export function getCachedOffers(): OfferRecord[] {
  try {
    const raw = localStorage.getItem(OFFERS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OfferRecord[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Fallback to canonical offers
  }
  return CANONICAL_OFFERS;
}

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

export function toCustomerFriendlyError(err: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Connection lost. Please check your internet and try again.';
  }
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('offline') ||
    lower.includes('unavailable')
  ) {
    return 'Connection lost. Please check your internet and try again.';
  }
  if (
    lower.includes('missing or insufficient permissions') ||
    lower.includes('permission-denied') ||
    lower.includes('firestore') ||
    lower.includes('operationtype') ||
    lower.includes('authinfo')
  ) {
    return 'Something went wrong. Please try again.';
  }
  if (raw.trim().length > 0 && raw.trim().length < 160 && !raw.trim().startsWith('{')) {
    return raw.trim();
  }
  return 'Something went wrong. Please try again.';
}

export function normalizeOrderRecord(raw: Partial<OrderRecord>): OrderRecord {
  const orderNumber = Number(raw.order_number || 1000);
  const orderCode = (raw.order_code || `RK${orderNumber}`).toUpperCase();

  let billStatus: BillStatus = raw.bill_status || 'not_generated';
  if (!raw.bill_status) {
    billStatus = raw.pdf_ready ? 'generated' : 'not_generated';
  }
  // Map any legacy 'sent' / 'sending' / 'retrying' bill status cleanly to website-native 'generated'
  if (
    billStatus !== 'not_generated' &&
    billStatus !== 'generating' &&
    billStatus !== 'generated' &&
    billStatus !== 'failed'
  ) {
    billStatus = raw.pdf_ready ? 'generated' : 'not_generated';
  }

  const defaultPaymentStatus: PaymentStatus =
    raw.payment_status || (raw.status === 'completed' ? 'paid' : 'pending');

  const rawSnapshot = raw.payment_qr_snapshot as PaymentQrSnapshot | null | undefined;
  const paymentQrSnapshot: PaymentQrSnapshot | null =
    rawSnapshot && typeof rawSnapshot === 'object'
      ? {
          mode: rawSnapshot.mode === 'uploaded_qr' ? 'uploaded_qr' : 'dynamic_upi',
          merchant_name: rawSnapshot.merchant_name || 'RikZen Fast Food',
          upi_id: rawSnapshot.upi_id || '',
          upi_uri: rawSnapshot.upi_uri || '',
          qr_image_url: rawSnapshot.qr_image_url || '',
          captured_at: rawSnapshot.captured_at || '',
        }
      : null;

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
    payment_status: defaultPaymentStatus,
    paid_at: typeof raw.paid_at === 'string' ? raw.paid_at : '',
    confirmed_at: typeof raw.confirmed_at === 'string' ? raw.confirmed_at : '',
    public_bill_id: typeof raw.public_bill_id === 'string' ? raw.public_bill_id : '',
    payment_qr_snapshot: paymentQrSnapshot,
    upi_uri: typeof raw.upi_uri === 'string' ? raw.upi_uri : '',
    pdf_ready: Boolean(raw.pdf_ready ?? billStatus === 'generated'),
    bill_status: billStatus,
    pdf_url: typeof raw.pdf_url === 'string' ? raw.pdf_url : '',
    pdf_path: typeof raw.pdf_path === 'string' ? raw.pdf_path : '',
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
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
    status: order.status,
    payment_status: order.payment_status,
    confirmed_at: order.confirmed_at || '',
    public_bill_id: order.public_bill_id || '',
    payment_qr_snapshot: order.payment_qr_snapshot || null,
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

/**
 * Public real-time subscription to restaurant UPI Payment Settings (UPI ID, Merchant Name, QR image URL).
 * Zero login required; falls back cleanly to Express `/api/payment-settings`.
 */
export function subscribeToPaymentSettings(
  onSettings: (settings: PaymentSettings) => void,
): Unsubscribe {
  const path = 'shop_settings/payment';

  // Fetch initial server fallback immediately so customer bills have UPI QR even before Firestore hydrates
  fetch('/api/payment-settings')
    .then((res) => (res.ok ? safeReadJson<{ settings?: PaymentSettings }>(res, 'Payment settings') : null))
    .then((parsed) => {
      if (parsed?.data?.settings) {
        onSettings({
          ...DEFAULT_PAYMENT_SETTINGS,
          ...parsed.data.settings,
        });
      }
    })
    .catch(() => {
      // Ignore fallback network error
    });

  return onSnapshot(
    doc(db, 'shop_settings', 'payment'),
    (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }
      const raw = snapshot.data() as Partial<PaymentSettings>;
      const qrImageUrl = typeof raw.qr_image_url === 'string' ? raw.qr_image_url.trim() : '';
      const paymentMode: PaymentMode =
        raw.payment_mode === 'uploaded_qr' || raw.payment_mode === 'dynamic_upi'
          ? raw.payment_mode
          : qrImageUrl
            ? 'uploaded_qr'
            : 'dynamic_upi';
      onSettings({
        id: 'payment',
        payment_mode: paymentMode,
        upi_id: typeof raw.upi_id === 'string' ? raw.upi_id.trim() : '',
        merchant_name:
          typeof raw.merchant_name === 'string' && raw.merchant_name.trim()
            ? raw.merchant_name.trim()
            : DEFAULT_PAYMENT_SETTINGS.merchant_name,
        qr_image_url: qrImageUrl,
        updated_at: raw.updated_at,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // Fallback already attempted via /api/payment-settings
      }
    },
  );
}

/**
 * Syncs owner's Firestore PaymentSettings into the Express backend so server-generated PDFs
 * immediately use the latest saved QR mode and settings for new bills.
 */
export async function syncPaymentSettingsToServer(settings: PaymentSettings): Promise<void> {
  try {
    const headers = await getOwnerAuthHeader();
    await fetch('/api/owner/payment-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        payment_mode: settings.payment_mode || 'dynamic_upi',
        upi_id: settings.upi_id.trim(),
        merchant_name: settings.merchant_name.trim() || 'RikZen Fast Food',
        qr_image_url: settings.qr_image_url.trim(),
      }),
    });
  } catch {
    // Non-blocking background sync
  }
}

/**
 * Owner action: Uploads restaurant Payment QR image (PNG/JPG/JPEG/WEBP <= 5 MB) to confined server storage.
 */
export async function ownerUploadPaymentQrImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please upload a PNG, JPG, JPEG, or WEBP QR image.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Payment QR image must be smaller than 5 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected QR image.'));
    reader.readAsDataURL(file);
  });

  const headers = await getOwnerAuthHeader();
  const res = await fetch('/api/owner/upload-payment-qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ dataUrl }),
  });

  const { data: json, errorMessage } = await safeReadJson<{ url?: string; error?: string }>(
    res,
    'Payment QR upload',
  );
  if (!res.ok || !json?.url) {
    throw new Error(json?.error || errorMessage || 'Could not upload payment QR image.');
  }
  return json.url;
}

/**
 * Owner action: Deletes currently uploaded QR image reference (older bills retain their snapshot).
 */
export async function ownerDeletePaymentQr(currentSettings: PaymentSettings): Promise<PaymentSettings> {
  let serverSettings: PaymentSettings | null = null;
  try {
    const headers = await getOwnerAuthHeader();
    const res = await fetch(apiUrl('/api/owner/payment-qr'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    const parsed = await safeReadJson<{
      success?: boolean;
      settings?: PaymentSettings;
      error?: string;
    }>(res, 'Delete payment QR');
    if (res.ok && parsed.data?.success) {
      serverSettings = parsed.data.settings || null;
    } else if (!isStaticHostMissingEndpoint(res, parsed)) {
      throw new Error(parsed.data?.error || parsed.errorMessage || 'Could not remove uploaded payment QR.');
    }
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('failed to fetch')) {
      throw err;
    }
  }

  const nextSettings: PaymentSettings = serverSettings || {
    ...currentSettings,
    qr_image_url: '',
    payment_mode: currentSettings.upi_id ? 'dynamic_upi' : 'uploaded_qr',
    updated_at: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'shop_settings', 'payment'), {
      id: 'payment',
      payment_mode: nextSettings.payment_mode,
      upi_id: nextSettings.upi_id,
      merchant_name: nextSettings.merchant_name,
      qr_image_url: '',
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'shop_settings/payment');
  }

  return nextSettings;
}

/**
 * Owner action: Saves honest 2-mode Restaurant Payment Settings to both Express backend (when mounted) and Firestore.
 */
export async function ownerSavePaymentSettings(payload: {
  payment_mode: PaymentMode;
  upi_id: string;
  merchant_name: string;
  qr_image_url: string;
}): Promise<PaymentSettings> {
  const paymentMode: PaymentMode =
    payload.payment_mode === 'uploaded_qr' ? 'uploaded_qr' : 'dynamic_upi';
  const trimmedUpi = payload.upi_id.trim();
  if (trimmedUpi !== '' && !isValidUpiId(trimmedUpi)) {
    throw new Error('Please enter a valid UPI ID (example: rikzenfastfood@okaxis or 9876543210@ybl).');
  }
  if (paymentMode === 'dynamic_upi' && trimmedUpi === '') {
    throw new Error('Enter a valid Restaurant UPI ID for Dynamic Amount UPI QR mode.');
  }
  const merchantName = payload.merchant_name.trim().slice(0, 80);
  if (merchantName.length < 2) {
    throw new Error('Restaurant name must be at least 2 characters.');
  }
  const qrImageUrl = payload.qr_image_url.trim().slice(0, 500);
  if (paymentMode === 'uploaded_qr' && !qrImageUrl) {
    throw new Error('Please upload your restaurant payment QR image first.');
  }

  // 1. Sync to Express server if available (skip gracefully on static deployments like Netlify)
  let serverSettings: PaymentSettings | null = null;
  try {
    const headers = await getOwnerAuthHeader();
    const res = await fetch(apiUrl('/api/owner/payment-settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        payment_mode: paymentMode,
        upi_id: trimmedUpi,
        merchant_name: merchantName,
        qr_image_url: qrImageUrl,
      }),
    });
    const parsed = await safeReadJson<{
      success?: boolean;
      settings?: PaymentSettings;
      error?: string;
    }>(res, 'Save payment settings');
    if (res.ok && parsed.data?.success) {
      serverSettings = parsed.data.settings || null;
    } else if (!isStaticHostMissingEndpoint(res, parsed)) {
      throw new Error(
        parsed.data?.error || parsed.errorMessage || 'Could not save payment settings on server.',
      );
    }
  } catch (err) {
    if (err instanceof Error && !err.message.toLowerCase().includes('failed to fetch')) {
      throw err;
    }
  }

  // 2. Persist in Firestore `/shop_settings/payment` for real-time sync across owner & customer screens
  const path = 'shop_settings/payment';
  try {
    await setDoc(doc(db, 'shop_settings', 'payment'), {
      id: 'payment',
      payment_mode: paymentMode,
      upi_id: trimmedUpi,
      merchant_name: merchantName,
      qr_image_url: qrImageUrl,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  return (
    serverSettings || {
      id: 'payment',
      payment_mode: paymentMode,
      upi_id: trimmedUpi,
      merchant_name: merchantName,
      qr_image_url: qrImageUrl,
      updated_at: new Date().toISOString(),
    }
  );
}

export async function fetchOwnerConfigStatus(): Promise<{
  voiceTtsConfigured: boolean;
  paymentMode?: PaymentMode;
  paymentConfigured?: boolean;
}> {
  try {
    const headers = await getOwnerAuthHeader();
    const res = await fetch('/api/owner/config-status', { headers });
    if (!res.ok) return { voiceTtsConfigured: false };
    const { data } = await safeReadJson<{
      voiceTtsConfigured?: boolean;
      paymentMode?: PaymentMode;
      paymentConfigured?: boolean;
    }>(res, 'Owner config status');
    return {
      voiceTtsConfigured: Boolean(data?.voiceTtsConfigured),
      paymentMode: data?.paymentMode,
      paymentConfigured: Boolean(data?.paymentConfigured),
    };
  } catch {
    return { voiceTtsConfigured: false };
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
 * Authoritative Firestore-backed order verification used automatically when deployed on static
 * hosting (e.g., Netlify) where the Express `/api/orders/verify` endpoint is not mounted.
 * Reads live `menu_items` and `offers` directly from Firestore, recomputes every price/discount/total
 * from database records (never trusting client totals), and enforces deterministic idempotency.
 */
async function verifyOrderAgainstFirestore(params: {
  tableNumber: number;
  cartItems: CartItem[];
  customerName: string;
  customerMobile: string;
  customerSessionId: string;
  clientRequestId?: string;
  notes: string;
}): Promise<VerifiedOrderQuote> {
  const { tableNumber, cartItems, customerName, customerMobile, customerSessionId, notes } = params;

  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 6) {
    throw new Error('Invalid table number. Only Table 1 through Table 6 are supported.');
  }
  if (customerName.length < 2 || customerName.length > 80) {
    throw new Error('Please enter your name (at least 2 characters).');
  }
  if (!/^\+91[6-9][0-9]{9}$/.test(customerMobile)) {
    throw new Error('Please enter a valid 10-digit mobile number.');
  }
  if (!Array.isArray(cartItems) || cartItems.length < 1 || cartItems.length > 20) {
    throw new Error('Order must contain between 1 and 20 items.');
  }

  // Deterministic idempotent order ID so repeated clicks/retries map to the exact same Firestore doc
  const requestKey = params.clientRequestId?.trim() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const idSeed = await sha256Hex(`rikzen_order|${customerSessionId}|${requestKey}`);
  const deterministicOrderId = `ord_${idSeed.slice(0, 32)}`;

  // Check if this exact request already saved an order in Firestore (prevents duplicate orders)
  try {
    const existingSnap = await getDoc(doc(db, 'orders', deterministicOrderId));
    if (existingSnap.exists()) {
      const existing = normalizeOrderRecord(existingSnap.data() as Partial<OrderRecord>);
      return {
        id: existing.id,
        order_number: existing.order_number,
        order_code: existing.order_code,
        table_id: existing.table_id,
        table_number: existing.table_number,
        customer_name: existing.customer_name,
        customer_mobile: existing.customer_mobile,
        items: existing.items,
        subtotal: existing.subtotal,
        discount: existing.discount,
        total: existing.total,
        customer_session_id: existing.customer_session_id,
        item_count: existing.item_count,
        status: 'pending',
        payment_status: existing.payment_status,
        paid_at: existing.paid_at,
        confirmed_at: existing.confirmed_at,
        public_bill_id: existing.public_bill_id || existing.id,
        bill_page_url: `/bill/${existing.public_bill_id || existing.id}`,
        payment_qr_snapshot: existing.payment_qr_snapshot,
        upi_uri: existing.upi_uri,
        pdf_ready: existing.pdf_ready,
        bill_status: existing.bill_status,
        pdf_url: existing.pdf_url,
        pdf_path: existing.pdf_path,
        generated_at: existing.generated_at,
        server_signature: existing.server_signature,
        notes: existing.notes,
        idempotent_replay: true,
      };
    }
  } catch {
    // Proceed with fresh catalog verification
  }

  // Fetch live authoritative menu items & offers directly from Firestore
  const [menuSnap, offersSnap] = await Promise.all([
    getDocs(collection(db, 'menu_items')),
    getDocs(collection(db, 'offers')),
  ]);

  const liveMenuList: MenuItem[] = menuSnap.empty
    ? CANONICAL_MENU_ITEMS
    : menuSnap.docs.map((d) => {
        const raw = d.data() as Partial<MenuItem>;
        return {
          ...raw,
          id: raw.id || d.id,
          offer_price: typeof raw.offer_price === 'number' ? raw.offer_price : 0,
        } as MenuItem;
      });

  const liveOfferList: OfferRecord[] = offersSnap.empty
    ? CANONICAL_OFFERS
    : offersSnap.docs.map((d) => {
        const raw = d.data() as Partial<OfferRecord>;
        return { ...raw, id: raw.id || d.id } as OfferRecord;
      });

  const menuMap = new Map(liveMenuList.map((m) => [m.id, m]));
  const offerMap = new Map(liveOfferList.map((o) => [o.id, o]));

  const mergedLines = new Map<string, { kind: 'menu' | 'offer'; id: string; quantity: number }>();
  for (const rawItem of cartItems) {
    const id = String(rawItem.id || '').trim();
    const kind: 'menu' | 'offer' = rawItem.kind === 'offer' ? 'offer' : 'menu';
    const qty = Number(rawItem.quantity);
    if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      throw new Error('Invalid menu item identifier.');
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('Item quantity must be between 1 and 20.');
    }
    const key = `${kind}:${id}`;
    const nextQty = (mergedLines.get(key)?.quantity || 0) + qty;
    if (nextQty > 20) {
      throw new Error('Maximum quantity per item is 20.');
    }
    mergedLines.set(key, { kind, id, quantity: nextQty });
  }

  const verifiedItems: OrderRecord['items'] = [];
  let subtotal = 0;
  let total = 0;
  let itemCount = 0;

  for (const entry of mergedLines.values()) {
    if (entry.kind === 'offer') {
      const offer = offerMap.get(entry.id);
      if (!offer || !offer.active) {
        throw new Error(`Offer "${offer?.title || entry.id}" is no longer active.`);
      }
      const regularPrice = Math.round(offer.regular_price);
      const unitPrice = Math.round(offer.offer_price);
      const lineTotal = unitPrice * entry.quantity;
      subtotal += regularPrice * entry.quantity;
      total += lineTotal;
      itemCount += entry.quantity;
      verifiedItems.push({
        menu_item_id: offer.id,
        name: offer.title.slice(0, 80),
        regular_price: regularPrice,
        unit_price: unitPrice,
        quantity: entry.quantity,
        line_total: lineTotal,
      });
    } else {
      const item = menuMap.get(entry.id);
      if (!item || !item.available) {
        throw new Error(`${item?.name || entry.id} is currently unavailable.`);
      }
      const regularPrice = Math.round(item.price);
      const hasOffer = item.offer_price > 0 && item.offer_price < item.price;
      const unitPrice = hasOffer ? Math.round(item.offer_price) : regularPrice;
      const lineTotal = unitPrice * entry.quantity;
      subtotal += regularPrice * entry.quantity;
      total += lineTotal;
      itemCount += entry.quantity;
      verifiedItems.push({
        menu_item_id: item.id,
        name: item.name.slice(0, 80),
        regular_price: regularPrice,
        unit_price: unitPrice,
        quantity: entry.quantity,
        line_total: lineTotal,
      });
    }
  }

  const discount = Math.max(0, subtotal - total);
  if (itemCount < 1 || itemCount > 100 || subtotal < 1 || subtotal > 50000 || total < 1) {
    throw new Error('Order limits exceeded.');
  }

  // Generate clean 5-6 digit order number (10000..999999) derived from deterministic hash + time
  const hashNumeric = parseInt(idSeed.slice(32, 40), 16);
  const orderNumber = 1000 + (hashNumeric % 89000);
  const orderCode = `RK${orderNumber}`;
  const tableId = `table_${tableNumber}`;
  // Use unguessable orderId as public_bill_id so /bill/{id} resolves cleanly from Firestore on Netlify too
  const publicBillId = deterministicOrderId;

  const signature = await sha256Hex(
    JSON.stringify({
      id: deterministicOrderId,
      order_number: orderNumber,
      order_code: orderCode,
      table_id: tableId,
      table_number: tableNumber,
      customer_name: customerName,
      customer_mobile: customerMobile,
      items: verifiedItems,
      subtotal,
      discount,
      total,
      customer_session_id: customerSessionId,
      notes,
    }),
  );

  return {
    id: deterministicOrderId,
    order_number: orderNumber,
    order_code: orderCode,
    table_id: tableId,
    table_number: tableNumber,
    customer_name: customerName,
    customer_mobile: customerMobile,
    items: verifiedItems,
    subtotal,
    discount,
    total,
    customer_session_id: customerSessionId,
    item_count: itemCount,
    status: 'pending',
    payment_status: 'pending',
    paid_at: '',
    confirmed_at: '',
    public_bill_id: publicBillId,
    bill_page_url: `/bill/${publicBillId}`,
    payment_qr_snapshot: null,
    upi_uri: '',
    pdf_ready: false,
    bill_status: 'not_generated',
    pdf_url: '',
    pdf_path: '',
    generated_at: '',
    server_signature: signature,
    notes,
  };
}

/**
 * Sends table, customer details, idempotency key, and cart items to Express backend for
 * authoritative server-side price, offer discount, and HMAC signing.
 * Automatically executes authoritative Firestore catalog verification when deployed on static
 * hosting (e.g. Netlify) where `/api/orders/verify` is not mounted.
 */
export async function verifyOrderOnServer(
  tableNumber: number,
  cartItems: CartItem[],
  customer: CustomerDetails,
  clientRequestId?: string,
): Promise<VerifiedOrderQuote> {
  const customerSessionId = getOrCreateCustomerSessionId();
  const cleanName = customer.name.trim().slice(0, 80);
  const cleanMobileDigits = customer.mobileDigits.replace(/\D/g, '').slice(0, 10);
  const customerMobile = `+91${cleanMobileDigits}`;
  const notes = customer.notes.trim().slice(0, 200);

  const clientSubtotal = cartItems.reduce((sum, entry) => sum + entry.regularPrice * entry.quantity, 0);
  const clientTotal = cartItems.reduce((sum, entry) => sum + entry.effectivePrice * entry.quantity, 0);
  const clientDiscount = Math.max(0, clientSubtotal - clientTotal);

  const payload = {
    tableNumber,
    customerName: cleanName,
    customerMobile,
    customerSessionId,
    clientRequestId: clientRequestId || undefined,
    notes,
    clientSubtotal,
    clientDiscount,
    clientTotal,
    items: cartItems.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      quantity: entry.quantity,
    })),
  };

  let response: Response | null = null;
  try {
    response = await fetch(apiUrl('/api/orders/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[RikZen Order Verify Network Error]', err);
    throw new Error('Connection lost. Please check your internet and try again.');
  }

  const parsed = await safeReadJson<VerifiedOrderQuote & { error?: string }>(
    response,
    'Order verification',
  );

  if (response.ok && parsed.data && parsed.data.id) {
    return parsed.data;
  }

  // If deployed on static hosting (e.g. Netlify) where `/api/orders/verify` returns 404/405/HTML,
  // run real authoritative verification against live Firestore menu & offers collections.
  if (isStaticHostMissingEndpoint(response, parsed)) {
    return verifyOrderAgainstFirestore({
      tableNumber,
      cartItems,
      customerName: cleanName,
      customerMobile,
      customerSessionId,
      clientRequestId,
      notes,
    });
  }

  throw new Error(parsed.data?.error || parsed.errorMessage || 'Something went wrong. Please try again.');
}

/**
 * Persists a verified order into Firestore as `status: 'pending'` so the Owner
 * Dashboard receives it immediately in real time. Never writes to `menu_items`.
 * Idempotent: if the exact order ID was already created on an earlier attempt, returns it cleanly.
 */
export async function createConfirmedOrder(quote: VerifiedOrderQuote): Promise<string> {
  const path = `orders/${quote.id}`;
  try {
    if (quote.idempotent_replay) {
      const existingSnap = await getDoc(doc(db, 'orders', quote.id));
      if (existingSnap.exists()) {
        setStoredOrderIdForTable(quote.table_number, quote.id);
        return quote.id;
      }
    }

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
      payment_status: 'pending',
      paid_at: '',
      confirmed_at: '',
      public_bill_id: quote.public_bill_id || quote.id,
      payment_qr_snapshot: quote.payment_qr_snapshot || null,
      upi_uri: quote.upi_uri || '',
      pdf_ready: Boolean(quote.pdf_ready),
      bill_status: quote.bill_status || 'not_generated',
      pdf_url: quote.pdf_url || '',
      pdf_path: quote.pdf_path || '',
      generated_at: quote.generated_at || '',
      customer_session_id: quote.customer_session_id,
      server_signature: quote.server_signature,
      notes: quote.notes.slice(0, 200),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    setStoredOrderIdForTable(quote.table_number, quote.id);
    return quote.id;
  } catch (error) {
    console.error('[RikZen Customer Order Create Error]', { path, error });
    throw new Error(toCustomerFriendlyError(error));
  }
}

/**
 * Fetches a website-native public bill by `public_bill_id` (zero login required).
 * Works seamlessly on both Express backend AND static Netlify deployments via Firestore.
 */
export interface PublicBillPayload {
  public_bill_id: string;
  order_code: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string;
  items: OrderRecord['items'];
  subtotal: number;
  discount: number;
  total: number;
  notes: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  created_at_iso: string;
  confirmed_at: string;
  generated_at: string;
  pdf_url: string;
  filename: string;
  payment_qr_snapshot: PaymentQrSnapshot | null;
}

async function fetchLivePaymentSettingsFromFirestore(): Promise<PaymentSettings> {
  try {
    const snap = await getDoc(doc(db, 'shop_settings', 'payment'));
    if (snap.exists()) {
      const raw = snap.data() as Partial<PaymentSettings>;
      const qrImageUrl = typeof raw.qr_image_url === 'string' ? raw.qr_image_url.trim() : '';
      const paymentMode: PaymentMode =
        raw.payment_mode === 'uploaded_qr' || raw.payment_mode === 'dynamic_upi'
          ? raw.payment_mode
          : qrImageUrl
            ? 'uploaded_qr'
            : 'dynamic_upi';
      return {
        id: 'payment',
        payment_mode: paymentMode,
        upi_id: typeof raw.upi_id === 'string' ? raw.upi_id.trim() : '',
        merchant_name:
          typeof raw.merchant_name === 'string' && raw.merchant_name.trim()
            ? raw.merchant_name.trim()
            : DEFAULT_PAYMENT_SETTINGS.merchant_name,
        qr_image_url: qrImageUrl,
      };
    }
  } catch {
    // Fallback to defaults
  }
  return DEFAULT_PAYMENT_SETTINGS;
}

export async function fetchPublicBillById(billId: string): Promise<PublicBillPayload> {
  const cleanId = billId.trim();
  const res = await fetch(apiUrl(`/api/public/bills/${encodeURIComponent(cleanId)}`), {
    method: 'GET',
    cache: 'no-store',
  });
  const parsed = await safeReadJson<{
    success?: boolean;
    bill?: PublicBillPayload;
    error?: string;
  }>(res, 'Load bill');

  if (res.ok && parsed.data?.success && parsed.data.bill) {
    return parsed.data.bill;
  }

  // Direct Firestore lookup for unguessable order IDs (`ord_...`) when static hosted (Netlify)
  if (/^ord_[a-zA-Z0-9_-]{20,124}$/.test(cleanId)) {
    const snap = await getDoc(doc(db, 'orders', cleanId));
    if (snap.exists()) {
      const ord = normalizeOrderRecord(snap.data() as Partial<OrderRecord>);
      let snapshot = ord.payment_qr_snapshot;
      if (!snapshot) {
        const settings = await fetchLivePaymentSettingsFromFirestore();
        snapshot = createPaymentQrSnapshot({
          settings,
          amount: ord.total,
          orderCode: ord.order_code,
          tableNumber: ord.table_number,
        });
      }
      return {
        public_bill_id: ord.public_bill_id || ord.id,
        order_code: ord.order_code,
        table_number: ord.table_number,
        customer_name: ord.customer_name,
        customer_mobile: ord.customer_mobile,
        items: ord.items,
        subtotal: ord.subtotal,
        discount: ord.discount,
        total: ord.total,
        notes: ord.notes,
        status: ord.status,
        payment_status: ord.payment_status,
        created_at_iso: timestampToDate(ord.created_at).toISOString(),
        confirmed_at: ord.confirmed_at || '',
        generated_at: ord.generated_at || '',
        pdf_url: ord.pdf_url || '',
        filename: getOrderBillFilename(ord),
        payment_qr_snapshot: snapshot,
      };
    }
  }

  throw new Error(parsed.data?.error || parsed.errorMessage || 'Bill not found.');
}

/**
 * Unified PDF Bill Generation & Verification Helper.
 * Uses the Express PDFKit backend when mounted; falls back seamlessly to Firestore QR snapshot +
 * browser-native PDF generation when deployed on static hosting (e.g., Netlify).
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
    res = await fetch(apiUrl('/api/bills/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        order: buildOrderPayloadForServer(order),
        forceRegenerate: Boolean(options.forceRegenerate),
      }),
    });
  } catch (networkErr) {
    console.error('[RikZen PDF Generate Network Error]', networkErr);
    throw new Error('Connection lost while generating PDF bill. Please try again.');
  }

  const parsed = await safeReadJson<Partial<GeneratedBillResult> & { error?: string }>(
    res,
    'PDF bill generation',
  );
  const json = parsed.data || {};

  // Static hosting (Netlify): build immutable QR snapshot from Firestore PaymentSettings directly
  if (isStaticHostMissingEndpoint(res, parsed)) {
    const existingSnapshot = !options.forceRegenerate ? order.payment_qr_snapshot : null;
    const settings = existingSnapshot ? null : await fetchLivePaymentSettingsFromFirestore();
    const snapshot =
      existingSnapshot ||
      createPaymentQrSnapshot({
        settings: settings || DEFAULT_PAYMENT_SETTINGS,
        amount: order.total,
        orderCode: (order.order_code || `RK${order.order_number}`).toUpperCase(),
        tableNumber: order.table_number,
      });

    const generatedAt = order.generated_at || new Date().toISOString();
    const publicBillId = order.id; // `ord_...` resolves directly from Firestore with zero login
    const fallbackResult: GeneratedBillResult = {
      ok: true,
      order_id: order.id,
      order_code: (order.order_code || `RK${order.order_number}`).toUpperCase(),
      public_bill_id: publicBillId,
      bill_page_url: `/bill/${publicBillId}`,
      filename: getOrderBillFilename(order),
      bill_status: 'generated',
      pdf_url: '',
      pdf_path: '',
      generated_at: generatedAt,
      size_bytes: 0,
      upi_uri: snapshot.upi_uri || '',
      upi_id: snapshot.upi_id || '',
      payment_qr_snapshot: snapshot,
    };

    if (isOwnerSession) {
      try {
        await updateDoc(doc(db, 'orders', order.id), {
          pdf_ready: true,
          bill_status: 'generated',
          generated_at: generatedAt,
          public_bill_id: publicBillId,
          payment_qr_snapshot: snapshot,
          ...(snapshot.upi_uri ? { upi_uri: snapshot.upi_uri } : {}),
          updated_at: serverTimestamp(),
        });
      } catch (syncErr) {
        console.error('[RikZen Static Bill Metadata Sync Warning]', syncErr);
      }
    }

    return fallbackResult;
  }

  if (!res.ok || !json.ok || !json.pdf_url || !json.pdf_path) {
    const errMsg = json.error || parsed.errorMessage || `Bill generation failed (HTTP ${res.status}).`;
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
    public_bill_id: json.public_bill_id || order.public_bill_id || order.id,
    bill_page_url:
      json.bill_page_url || `/bill/${json.public_bill_id || order.public_bill_id || order.id}`,
    filename: json.filename || getOrderBillFilename(order),
    bill_status: 'generated',
    pdf_url: json.pdf_url,
    pdf_path: json.pdf_path,
    generated_at: json.generated_at || new Date().toISOString(),
    size_bytes: Number(json.size_bytes || 0),
    upi_uri: typeof json.upi_uri === 'string' ? json.upi_uri : order.upi_uri || '',
    upi_id: typeof json.upi_id === 'string' ? json.upi_id : '',
    payment_qr_snapshot: json.payment_qr_snapshot || order.payment_qr_snapshot || null,
  };

  if (
    isOwnerSession &&
    (order.pdf_url !== result.pdf_url ||
      order.pdf_path !== result.pdf_path ||
      order.public_bill_id !== result.public_bill_id ||
      order.upi_uri !== result.upi_uri ||
      !order.pdf_ready ||
      !order.payment_qr_snapshot ||
      order.bill_status !== 'generated')
  ) {
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        pdf_ready: true,
        bill_status: 'generated',
        pdf_url: result.pdf_url,
        pdf_path: result.pdf_path,
        generated_at: result.generated_at,
        ...(result.public_bill_id ? { public_bill_id: result.public_bill_id } : {}),
        ...(result.payment_qr_snapshot ? { payment_qr_snapshot: result.payment_qr_snapshot } : {}),
        ...(result.upi_uri ? { upi_uri: result.upi_uri } : {}),
        updated_at: serverTimestamp(),
      });
    } catch (syncErr) {
      console.error('[RikZen PDF Metadata Sync Warning]', syncErr);
    }
  }

  return result;
}

function triggerPdfBlobDownload(pdfBlob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(pdfBlob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

/**
 * Verifies and downloads a real `.pdf` bill directly to the user's Downloads folder as
 * `RikZen-Fast-Food-Bill-RK1024.pdf`. Works on both Express server and static Netlify hosts.
 */
export async function downloadOrderBillPdf(
  order: OrderRecord,
): Promise<GeneratedBillResult> {
  try {
    // 1. Ensure PDF / immutable QR snapshot exists
    const bill = await ensureOrderPdfGenerated(order, { persistIfOwner: true });

    // 2. If Express generated a stored PDF file, fetch & verify its `%PDF-` bytes
    if (bill.pdf_url) {
      const downloadUrl = `${apiUrl(bill.pdf_url)}${bill.pdf_url.includes('?') ? '&' : '?'}download=1`;
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

      const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
      triggerPdfBlobDownload(pdfBlob, bill.filename);
      return bill;
    }

    // 3. Static host mode (Netlify): generate valid `%PDF-` binary directly in the browser
    const clientPdfBlob = await generateClientBillPdfBlob(
      order,
      bill.payment_qr_snapshot || order.payment_qr_snapshot || null,
    );
    triggerPdfBlobDownload(clientPdfBlob, bill.filename);
    return { ...bill, size_bytes: clientPdfBlob.size };
  } catch (err) {
    console.error('[RikZen PDF Download Error]', { orderId: order.id, error: err });
    throw err instanceof Error ? err : new Error('Download failed. Please try again.');
  }
}

/**
 * Owner action: Generates & downloads a real Sales Report PDF
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

  const response = await fetch(apiUrl('/api/reports/pdf'), {
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
    const parsed = await safeReadJson<{ error?: string }>(response, 'Sales report PDF');
    if (isStaticHostMissingEndpoint(response, parsed)) {
      const clientBlob = generateClientSalesReportPdfBlob({
        reportType: params.reportType,
        periodLabel: params.periodLabel,
        orders: payloadOrders,
      });
      triggerPdfBlobDownload(clientBlob, params.filename);
      return params.filename;
    }
    throw new Error(
      parsed.data?.error ||
        parsed.errorMessage ||
        `Failed to generate report PDF (HTTP ${response.status}).`,
    );
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) {
    const clientBlob = generateClientSalesReportPdfBlob({
      reportType: params.reportType,
      periodLabel: params.periodLabel,
      orders: payloadOrders,
    });
    triggerPdfBlobDownload(clientBlob, params.filename);
    return params.filename;
  }

  const arrayBuffer = await response.arrayBuffer();
  const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
  const pdfMagic = String.fromCharCode(...headerBytes);
  if (arrayBuffer.byteLength < 512 || pdfMagic !== '%PDF-') {
    throw new Error('Generated sales report PDF was empty or invalid.');
  }

  const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
  triggerPdfBlobDownload(pdfBlob, params.filename);
  return params.filename;
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
      try {
        localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(docs));
      } catch {
        // Ignore storage quota errors
      }
      onItems(docs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onItems(getCachedMenuItems());
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
      try {
        localStorage.setItem(OFFERS_CACHE_KEY, JSON.stringify(docs));
      } catch {
        // Ignore storage quota errors
      }
      onOffers(docs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onOffers(getCachedOffers());
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

  // 3. Menu Items (seed only if empty; safely patch any legacy doc missing offer_price without batch failure)
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
      for (const docSnap of existingMenu.docs) {
        const data = docSnap.data();
        if (typeof data.offer_price !== 'number') {
          const canonical = CANONICAL_MENU_ITEMS.find((c) => c.id === docSnap.id);
          try {
            await updateDoc(doc(db, 'menu_items', docSnap.id), {
              offer_price: canonical?.offer_price ?? 0,
              updated_at: serverTimestamp(),
            });
          } catch (docErr) {
            console.warn('[RikZen Menu Migration Warning]', docSnap.id, docErr);
          }
        }
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
  const nowIso = new Date().toISOString();
  const confirmedAt = order.confirmed_at || (nextStatus === 'accepted' ? nowIso : '');

  // On confirm (accepted) or bill_ready, guarantee the real stored PDF + immutable QR snapshot exist
  if (nextStatus === 'accepted' || nextStatus === 'bill_ready' || nextStatus === 'completed') {
    generatedBill = await ensureOrderPdfGenerated(
      {
        ...order,
        status: nextStatus,
        confirmed_at: confirmedAt || nowIso,
      },
      { persistIfOwner: false },
    );
  }

  try {
    const batch = writeBatch(db);
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      pdf_ready: nextStatus !== 'rejected' && Boolean(generatedBill || order.pdf_ready),
      updated_at: serverTimestamp(),
    };

    if (confirmedAt) {
      updatePayload.confirmed_at = confirmedAt;
    }

    if (generatedBill) {
      updatePayload.pdf_url = generatedBill.pdf_url;
      updatePayload.pdf_path = generatedBill.pdf_path;
      updatePayload.generated_at = generatedBill.generated_at;
      updatePayload.bill_status = 'generated';
      if (generatedBill.public_bill_id) {
        updatePayload.public_bill_id = generatedBill.public_bill_id;
      }
      if (generatedBill.payment_qr_snapshot) {
        updatePayload.payment_qr_snapshot = generatedBill.payment_qr_snapshot;
      }
      if (generatedBill.upi_uri) {
        updatePayload.upi_uri = generatedBill.upi_uri;
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
 * Owner action: Manually updates real payment status (never auto-marked paid just because QR was shown).
 */
export async function ownerUpdatePaymentStatus(
  order: OrderRecord,
  paymentStatus: PaymentStatus,
): Promise<void> {
  const orderPath = `orders/${order.id}`;
  try {
    await updateDoc(doc(db, 'orders', order.id), {
      payment_status: paymentStatus,
      paid_at: paymentStatus === 'paid' ? new Date().toISOString() : '',
      updated_at: serverTimestamp(),
    });
    // Keep public bill page's payment_status in sync without mutating its immutable QR snapshot
    if (order.pdf_ready || order.public_bill_id) {
      ensureOrderPdfGenerated(
        { ...order, payment_status: paymentStatus },
        { persistIfOwner: false, forceRegenerate: false },
      ).catch(() => {});
    }
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
