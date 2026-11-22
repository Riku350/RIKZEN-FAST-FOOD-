import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import express, { NextFunction, Request, Response } from 'express';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { CANONICAL_MENU_ITEMS, CANONICAL_OFFERS } from './src/data/menuCatalog.ts';
import { generateBrandedBillPdfBuffer } from './src/lib/pdfBillGenerator.ts';
import { generateSalesReportPdfBuffer, type SalesReportOrderRow } from './src/lib/pdfReportGenerator.ts';
import {
  buildDynamicUpiUri,
  createPaymentQrSnapshot,
  DEFAULT_PAYMENT_SETTINGS,
  isValidUpiId,
  type PaymentSettings,
} from './src/lib/upiPayment.ts';
import type {
  MenuItem,
  OfferRecord,
  OrderLineItem,
  PaymentMode,
  PaymentQrSnapshot,
} from './src/types/restaurant.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const BOOTSTRAPPED_OWNER_EMAIL = 'rikudatabackup@gmail.com';

// Read Firebase projectId for ID token audience/issuer verification
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
let FIREBASE_PROJECT_ID = '';
try {
  if (fs.existsSync(firebaseConfigPath)) {
    const parsed = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8')) as {
      projectId?: string;
    };
    FIREBASE_PROJECT_ID = parsed.projectId || '';
  }
} catch {
  FIREBASE_PROJECT_ID = '';
}

const ORDER_SIGNING_SECRET =
  process.env.ORDER_SIGNING_SECRET && process.env.ORDER_SIGNING_SECRET.trim().length >= 16
    ? process.env.ORDER_SIGNING_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

// Shared server-side Gemini client for Natural Indian Female Voice TTS
let sharedGeminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  if (!sharedGeminiClient) {
    sharedGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return sharedGeminiClient;
}

// Monotonic server-side order number starting cleanly at 1024
let currentOrderSequence = 1023 + (Math.floor(Date.now() / 60000) % 50);

// Authoritative server-side catalog synced by verified owner
const liveMenuMap = new Map<string, MenuItem>(
  CANONICAL_MENU_ITEMS.map((item) => [item.id, item]),
);
const liveOfferMap = new Map<string, OfferRecord>(
  CANONICAL_OFFERS.map((offer) => [offer.id, offer]),
);

// Confined server storage directories
const UPLOADS_DIR = path.resolve(__dirname, 'src', 'assets', 'uploads');
const BILLS_DIR = path.resolve(__dirname, 'bills');
const DATA_DIR = path.resolve(__dirname, 'data');
const PUBLIC_BILLS_DIR = path.resolve(DATA_DIR, 'public-bills');
const PAYMENT_SETTINGS_FILE = path.resolve(DATA_DIR, 'payment-settings.json');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(BILLS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_BILLS_DIR, { recursive: true });

// 15-minute idempotency cache preventing duplicate orders on rapid double-clicks / retries
const ORDER_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000;
const orderIdempotencyCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

function pruneOrderIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, entry] of orderIdempotencyCache.entries()) {
    if (entry.expiresAt <= now) {
      orderIdempotencyCache.delete(key);
    }
  }
}

function loadPersistedPaymentSettings(): { settings: PaymentSettings; updatedAtMs: number } {
  try {
    if (fs.existsSync(PAYMENT_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PAYMENT_SETTINGS_FILE, 'utf8')) as Partial<PaymentSettings>;
      const upiId =
        typeof parsed.upi_id === 'string' && (parsed.upi_id === '' || isValidUpiId(parsed.upi_id))
          ? parsed.upi_id.trim()
          : '';
      const merchantName =
        typeof parsed.merchant_name === 'string' && parsed.merchant_name.trim().length >= 2
          ? parsed.merchant_name.trim().slice(0, 80)
          : DEFAULT_PAYMENT_SETTINGS.merchant_name;
      const qrImageUrl =
        typeof parsed.qr_image_url === 'string' &&
        (parsed.qr_image_url === '' ||
          parsed.qr_image_url.startsWith('/uploads/') ||
          parsed.qr_image_url.startsWith('/src/assets/') ||
          parsed.qr_image_url.startsWith('/assets/') ||
          parsed.qr_image_url.startsWith('https://'))
          ? parsed.qr_image_url.slice(0, 500)
          : '';
      const paymentMode: PaymentMode =
        parsed.payment_mode === 'uploaded_qr' || parsed.payment_mode === 'dynamic_upi'
          ? parsed.payment_mode
          : qrImageUrl
            ? 'uploaded_qr'
            : 'dynamic_upi';
      const stat = fs.statSync(PAYMENT_SETTINGS_FILE);
      return {
        settings: {
          id: 'payment',
          payment_mode: paymentMode,
          upi_id: upiId,
          merchant_name: merchantName,
          qr_image_url: qrImageUrl,
          updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : stat.mtime.toISOString(),
        },
        updatedAtMs: stat.mtimeMs,
      };
    }
  } catch {
    // Fallback to defaults
  }
  return {
    settings: { ...DEFAULT_PAYMENT_SETTINGS },
    updatedAtMs: 0,
  };
}

const initialPaymentState = loadPersistedPaymentSettings();
let livePaymentSettings: PaymentSettings = initialPaymentState.settings;

function savePersistedPaymentSettings(next: PaymentSettings): void {
  const safePath = path.resolve(DATA_DIR, 'payment-settings.json');
  if (!safePath.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid payment settings path.');
  }
  const tempPath = path.resolve(DATA_DIR, `.tmp_payment_${crypto.randomBytes(6).toString('hex')}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tempPath, safePath);
  livePaymentSettings = next;
}

function resolveLocalUploadImageBuffer(qrImageUrl?: string): Buffer | null {
  if (!qrImageUrl || typeof qrImageUrl !== 'string') return null;
  if (!qrImageUrl.startsWith('/uploads/')) return null;
  const filename = path.basename(qrImageUrl);
  if (!/^[a-zA-Z0-9._-]{3,120}$/.test(filename)) return null;
  const fullPath = path.resolve(UPLOADS_DIR, filename);
  if (!fullPath.startsWith(UPLOADS_DIR + path.sep)) return null;
  try {
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size < 100 || stat.size > 5 * 1024 * 1024) return null;
    return fs.readFileSync(fullPath);
  } catch {
    return null;
  }
}

interface StoredPublicBillRecord {
  public_bill_id: string;
  order_id: string;
  order_code: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string;
  items: OrderLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  notes: string;
  status: string;
  payment_status: string;
  created_at_iso: string;
  confirmed_at: string;
  generated_at: string;
  pdf_url: string;
  filename: string;
  payment_qr_snapshot: PaymentQrSnapshot;
}

function getOrderSnapshotPath(orderDir: string): string {
  const snapshotPath = path.resolve(orderDir, 'bill-snapshot.json');
  if (!snapshotPath.startsWith(orderDir + path.sep)) {
    throw new Error('Invalid bill snapshot path.');
  }
  return snapshotPath;
}

function getPublicBillIndexPath(publicBillId: string): string {
  const safeId = publicBillId.trim();
  if (!/^RK[0-9]{4,8}-[a-fA-F0-9]{8,24}$/.test(safeId)) {
    throw new Error('Invalid public bill identifier.');
  }
  const filePath = path.resolve(PUBLIC_BILLS_DIR, `${safeId}.json`);
  if (!filePath.startsWith(PUBLIC_BILLS_DIR + path.sep)) {
    throw new Error('Invalid public bill index path.');
  }
  return filePath;
}

function readExistingOrderSnapshot(orderDir: string): StoredPublicBillRecord | null {
  try {
    const p = getOrderSnapshotPath(orderDir);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as StoredPublicBillRecord;
  } catch {
    return null;
  }
}

function writePublicBillRecord(orderDir: string, record: StoredPublicBillRecord): void {
  fs.mkdirSync(orderDir, { recursive: true });
  const orderSnapPath = getOrderSnapshotPath(orderDir);
  const tmpOrderSnap = path.resolve(orderDir, `.tmp_snap_${crypto.randomBytes(6).toString('hex')}.json`);
  fs.writeFileSync(tmpOrderSnap, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmpOrderSnap, orderSnapPath);

  const pubPath = getPublicBillIndexPath(record.public_bill_id);
  const tmpPub = path.resolve(PUBLIC_BILLS_DIR, `.tmp_pub_${crypto.randomBytes(6).toString('hex')}.json`);
  fs.writeFileSync(tmpPub, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmpPub, pubPath);
}

function readPublicBillRecord(publicBillId: string): StoredPublicBillRecord | null {
  try {
    const pubPath = getPublicBillIndexPath(publicBillId);
    if (!fs.existsSync(pubPath)) return null;
    return JSON.parse(fs.readFileSync(pubPath, 'utf8')) as StoredPublicBillRecord;
  } catch {
    return null;
  }
}

function resolvePublicOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// Google Firebase Auth public x509 certs cache
let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  );
  if (!resp.ok) {
    throw new Error('Unable to fetch Firebase verification certificates.');
  }
  const cacheHeader = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheHeader.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + maxAgeSec * 1000;
  return cachedCerts;
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

async function verifyOwnerIdToken(authHeader?: string): Promise<{ uid: string; email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      email?: string;
      email_verified?: boolean;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
    if (FIREBASE_PROJECT_ID) {
      if (payload.aud !== FIREBASE_PROJECT_ID) return null;
      if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    }
    if (!payload.email_verified || !payload.email) return null;
    if (payload.email.toLowerCase() !== BOOTSTRAPPED_OWNER_EMAIL.toLowerCase()) return null;

    const certs = await getFirebasePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const signatureValid = verifier.verify(certPem, base64UrlDecode(parts[2]));
    if (!signatureValid) return null;

    return { uid: payload.sub || '', email: payload.email };
  } catch {
    return null;
  }
}



interface SignableOrderPayload {
  id: string;
  order_number: number;
  order_code: string;
  table_id: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string;
  items: OrderLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  customer_session_id: string;
}

interface BillOrderRequest extends SignableOrderPayload {
  server_signature?: string;
  notes?: string;
  created_at_iso?: string;
  confirmed_at?: string;
  status?: string;
  payment_status?: string;
  public_bill_id?: string;
  payment_qr_snapshot?: PaymentQrSnapshot | null;
}

function normalizeIndianMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, '');
  const digitsOnly = cleaned.replace(/^\+91/, '').replace(/\D/g, '');
  if (!/^[6-9][0-9]{9}$/.test(digitsOnly)) {
    return null;
  }
  return `+91${digitsOnly}`;
}

function computeOrderSignature(data: SignableOrderPayload): string {
  const canonical = JSON.stringify({
    id: data.id,
    order_number: data.order_number,
    order_code: data.order_code,
    table_id: data.table_id,
    table_number: data.table_number,
    customer_name: data.customer_name,
    customer_mobile: data.customer_mobile,
    items: data.items.map((line) => ({
      menu_item_id: line.menu_item_id,
      name: line.name,
      regular_price: line.regular_price ?? line.unit_price,
      unit_price: line.unit_price,
      quantity: line.quantity,
      line_total: line.line_total,
    })),
    subtotal: data.subtotal,
    discount: data.discount,
    total: data.total,
    customer_session_id: data.customer_session_id,
  });

  return crypto.createHmac('sha256', ORDER_SIGNING_SECRET).update(canonical).digest('hex');
}

function verifyOrderSignature(data: SignableOrderPayload, providedSignature?: string): boolean {
  if (!providedSignature || !/^[a-fA-F0-9]{64}$/.test(providedSignature)) {
    return false;
  }
  const expected = computeOrderSignature(data);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(providedSignature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function computeBillFileToken(orderId: string, filename: string): string {
  return crypto
    .createHmac('sha256', ORDER_SIGNING_SECRET)
    .update(`billfile:${orderId}:${filename}`)
    .digest('hex');
}

function verifyBillFileToken(orderId: string, filename: string, providedSig: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(providedSig)) return false;
  const expected = computeBillFileToken(orderId, filename);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(providedSig, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildBillStorageInfo(orderId: string, orderCode: string) {
  const safeOrderId = orderId.trim();
  const safeOrderCode = orderCode.trim().toUpperCase();

  if (!/^ord_[a-zA-Z0-9_-]{20,120}$/.test(safeOrderId)) {
    throw new Error('Invalid order identifier for PDF storage.');
  }
  if (!/^RK[0-9]{4,8}$/.test(safeOrderCode)) {
    throw new Error('Invalid order code for PDF filename.');
  }

  const filename = `RikZen-Fast-Food-Bill-${safeOrderCode}.pdf`;
  const orderDir = path.resolve(BILLS_DIR, safeOrderId);
  if (!orderDir.startsWith(BILLS_DIR + path.sep)) {
    throw new Error('Invalid PDF storage directory.');
  }
  const absolutePath = path.resolve(orderDir, filename);
  if (!absolutePath.startsWith(orderDir + path.sep)) {
    throw new Error('Invalid PDF file destination.');
  }

  const pdfPath = `/bills/${safeOrderId}/${filename}`;
  const sig = computeBillFileToken(safeOrderId, filename);
  const pdfUrl = `/api/bills/file/${encodeURIComponent(safeOrderId)}/${encodeURIComponent(filename)}?sig=${sig}`;

  return {
    orderId: safeOrderId,
    orderCode: safeOrderCode,
    filename,
    orderDir,
    absolutePath,
    pdfPath,
    pdfUrl,
  };
}

function inspectStoredPdf(filePath: string): { valid: boolean; size: number } {
  try {
    if (!fs.existsSync(filePath)) return { valid: false, size: 0 };
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 512) return { valid: false, size: stat.size };
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(5);
    fs.readSync(fd, headerBuf, 0, 5, 0);
    fs.closeSync(fd);
    return { valid: headerBuf.toString('utf8') === '%PDF-', size: stat.size };
  } catch {
    return { valid: false, size: 0 };
  }
}

/**
 * Re-computes authoritative line totals, subtotal, discount, and final total on the server.
 */
function computeAuthoritativeBillAmounts(
  rawItems: OrderLineItem[],
  signatureAlreadyVerified: boolean,
): { items: OrderLineItem[]; subtotal: number; discount: number; total: number } {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 20) {
    throw new Error('Order contains no valid items for billing.');
  }

  const verifiedItems: OrderLineItem[] = [];
  let subtotal = 0;
  let total = 0;

  for (const raw of rawItems) {
    const qty = Number(raw?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('Invalid item quantity in order.');
    }

    const itemId = typeof raw?.menu_item_id === 'string' ? raw.menu_item_id.trim() : '';
    let regularPrice = 0;
    let unitPrice = 0;
    let itemName = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : itemId;

    if (signatureAlreadyVerified) {
      regularPrice = Math.max(1, Math.round(Number(raw.regular_price ?? raw.unit_price)));
      unitPrice = Math.max(1, Math.min(regularPrice, Math.round(Number(raw.unit_price))));
    } else {
      const menuMatch = liveMenuMap.get(itemId);
      const offerMatch = liveOfferMap.get(itemId);
      if (offerMatch) {
        itemName = offerMatch.title;
        regularPrice = Math.round(offerMatch.regular_price);
        unitPrice = Math.round(offerMatch.offer_price);
      } else if (menuMatch) {
        itemName = menuMatch.name;
        regularPrice = Math.round(menuMatch.price);
        unitPrice =
          menuMatch.offer_price > 0 && menuMatch.offer_price < menuMatch.price
            ? Math.round(menuMatch.offer_price)
            : regularPrice;
      } else {
        regularPrice = Math.max(1, Math.min(20000, Math.round(Number(raw.regular_price ?? raw.unit_price ?? 1))));
        unitPrice = Math.max(1, Math.min(regularPrice, Math.round(Number(raw.unit_price ?? regularPrice))));
      }
    }

    const lineTotal = unitPrice * qty;
    subtotal += regularPrice * qty;
    total += lineTotal;

    verifiedItems.push({
      menu_item_id: itemId || 'item',
      name: itemName,
      regular_price: regularPrice,
      unit_price: unitPrice,
      quantity: qty,
      line_total: lineTotal,
    });
  }

  const discount = Math.max(0, subtotal - total);
  return { items: verifiedItems, subtotal, discount, total };
}

async function ensureStoredBillPdf(
  params: {
    orderId: string;
    orderCode: string;
    tableNumber: number;
    customerName: string;
    customerMobile: string;
    items: OrderLineItem[];
    subtotal: number;
    discount: number;
    total: number;
    notes?: string;
    createdAtIso: string;
    confirmedAt?: string;
    status?: string;
    paymentStatus?: string;
    publicBillId?: string;
    existingQrSnapshot?: PaymentQrSnapshot | null;
  },
  options: { forceRegenerate?: boolean } = {},
) {
  const storage = buildBillStorageInfo(params.orderId, params.orderCode);
  const existingPdf = inspectStoredPdf(storage.absolutePath);
  const existingDiskSnapshot = readExistingOrderSnapshot(storage.orderDir);

  // Preserve immutable public_bill_id & payment_qr_snapshot for old bills so changing
  // restaurant QR tomorrow NEVER alters previously generated customer bills.
  const publicBillId =
    (params.publicBillId && /^RK[0-9]{4,8}-[a-fA-F0-9]{8,24}$/.test(params.publicBillId)
      ? params.publicBillId
      : null) ||
    existingDiskSnapshot?.public_bill_id ||
    `${storage.orderCode}-${crypto.randomBytes(6).toString('hex')}`;

  const qrSnapshot: PaymentQrSnapshot =
    (!options.forceRegenerate && (params.existingQrSnapshot || existingDiskSnapshot?.payment_qr_snapshot)) ||
    createPaymentQrSnapshot({
      settings: livePaymentSettings,
      amount: params.total,
      orderCode: storage.orderCode,
      tableNumber: params.tableNumber,
    });

  const confirmedAt =
    params.confirmedAt ||
    existingDiskSnapshot?.confirmed_at ||
    new Date().toISOString();

  if (!options.forceRegenerate && existingPdf.valid && existingDiskSnapshot) {
    // Keep public bill status/payment_status fresh without mutating immutable payment_qr_snapshot
    if (
      (params.paymentStatus && params.paymentStatus !== existingDiskSnapshot.payment_status) ||
      (params.status && params.status !== existingDiskSnapshot.status)
    ) {
      writePublicBillRecord(storage.orderDir, {
        ...existingDiskSnapshot,
        status: params.status || existingDiskSnapshot.status,
        payment_status: params.paymentStatus || existingDiskSnapshot.payment_status,
        confirmed_at: confirmedAt,
      });
    }
    const stat = fs.statSync(storage.absolutePath);
    return {
      ...storage,
      publicBillId,
      billPageUrl: `/bill/${publicBillId}`,
      paymentQrSnapshot: qrSnapshot,
      generatedAt: existingDiskSnapshot.generated_at || stat.mtime.toISOString(),
      sizeBytes: existingPdf.size,
      reused: true,
      upiUri: qrSnapshot.upi_uri,
      upiId: qrSnapshot.upi_id,
    };
  }

  const uploadedQrBuffer =
    qrSnapshot.mode === 'uploaded_qr'
      ? resolveLocalUploadImageBuffer(qrSnapshot.qr_image_url)
      : null;

  const pdfBuffer = await generateBrandedBillPdfBuffer({
    order_code: storage.orderCode,
    table_number: params.tableNumber,
    customer_name: params.customerName,
    customer_mobile: params.customerMobile,
    items: params.items,
    subtotal: params.subtotal,
    discount: params.discount,
    total: params.total,
    notes: params.notes,
    created_at_iso: params.createdAtIso,
    payment_mode: qrSnapshot.mode,
    upi_id: qrSnapshot.upi_id,
    merchant_name: qrSnapshot.merchant_name,
    upi_uri: qrSnapshot.upi_uri,
    uploaded_qr_buffer: uploadedQrBuffer,
  });

  if (pdfBuffer.length < 512 || pdfBuffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
    throw new Error('Generated bill buffer failed PDF integrity check.');
  }

  fs.mkdirSync(storage.orderDir, { recursive: true });
  const tempPath = path.resolve(
    storage.orderDir,
    `.tmp_${crypto.randomBytes(6).toString('hex')}.pdf`,
  );
  if (!tempPath.startsWith(storage.orderDir + path.sep)) {
    throw new Error('Invalid temporary PDF path.');
  }

  fs.writeFileSync(tempPath, pdfBuffer);
  fs.renameSync(tempPath, storage.absolutePath);

  const verified = inspectStoredPdf(storage.absolutePath);
  if (!verified.valid) {
    throw new Error('Stored PDF file could not be verified on server storage.');
  }

  const generatedAt = new Date().toISOString();
  writePublicBillRecord(storage.orderDir, {
    public_bill_id: publicBillId,
    order_id: storage.orderId,
    order_code: storage.orderCode,
    table_number: params.tableNumber,
    customer_name: params.customerName,
    customer_mobile: params.customerMobile,
    items: params.items,
    subtotal: params.subtotal,
    discount: params.discount,
    total: params.total,
    notes: params.notes || '',
    status: params.status || 'accepted',
    payment_status: params.paymentStatus || 'pending',
    created_at_iso: params.createdAtIso,
    confirmed_at: confirmedAt,
    generated_at: generatedAt,
    pdf_url: storage.pdfUrl,
    filename: storage.filename,
    payment_qr_snapshot: qrSnapshot,
  });

  return {
    ...storage,
    publicBillId,
    billPageUrl: `/bill/${publicBillId}`,
    paymentQrSnapshot: qrSnapshot,
    generatedAt,
    sizeBytes: verified.size,
    reused: false,
    upiUri: qrSnapshot.upi_uri,
    upiId: qrSnapshot.upi_id,
  };
}

interface RequestedLine {
  id: string;
  kind?: 'menu' | 'offer';
  quantity: number;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve owner-uploaded dish photos & payment QR images safely
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'ok', shop: 'RikZen Fast Food' });
});

app.get('/api/menu', (_req, res) => {
  res.json({
    success: true,
    items: Array.from(liveMenuMap.values()),
    offers: Array.from(liveOfferMap.values()),
  });
});

/**
 * Public non-secret restaurant Payment QR configuration (Mode 1 Uploaded QR or Mode 2 Dynamic UPI QR).
 */
app.get('/api/payment-settings', (_req, res) => {
  res.json({
    success: true,
    settings: livePaymentSettings,
  });
});

/**
 * Owner-authenticated Payment Settings update (honest 2-mode: uploaded_qr or dynamic_upi).
 */
app.post('/api/owner/payment-settings', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const body = req.body as {
    payment_mode?: unknown;
    upi_id?: unknown;
    merchant_name?: unknown;
    qr_image_url?: unknown;
  };

  const paymentMode: PaymentMode =
    body.payment_mode === 'uploaded_qr' || body.payment_mode === 'dynamic_upi'
      ? body.payment_mode
      : livePaymentSettings.payment_mode || 'dynamic_upi';

  const rawUpiId = typeof body.upi_id === 'string' ? body.upi_id.trim() : '';
  if (rawUpiId !== '' && !isValidUpiId(rawUpiId)) {
    res.status(400).json({
      success: false,
      error: 'Please enter a valid UPI ID (example: rikzenfastfood@okaxis or 9876543210@ybl).',
    });
    return;
  }

  if (paymentMode === 'dynamic_upi' && rawUpiId === '') {
    res.status(400).json({
      success: false,
      error: 'Enter a valid Restaurant UPI ID to use Dynamic Amount UPI QR mode.',
    });
    return;
  }

  const merchantName =
    typeof body.merchant_name === 'string' && body.merchant_name.trim().length >= 2
      ? body.merchant_name.trim().slice(0, 80)
      : 'RikZen Fast Food';

  const qrImageUrl = typeof body.qr_image_url === 'string' ? body.qr_image_url.trim().slice(0, 500) : '';
  if (
    qrImageUrl !== '' &&
    !qrImageUrl.startsWith('/uploads/') &&
    !qrImageUrl.startsWith('/src/assets/') &&
    !qrImageUrl.startsWith('/assets/') &&
    !qrImageUrl.startsWith('https://')
  ) {
    res.status(400).json({
      success: false,
      error: 'Invalid payment QR image URL.',
    });
    return;
  }

  if (paymentMode === 'uploaded_qr' && qrImageUrl === '') {
    res.status(400).json({
      success: false,
      error: 'Please upload your restaurant payment QR image first.',
    });
    return;
  }

  const updated: PaymentSettings = {
    id: 'payment',
    payment_mode: paymentMode,
    upi_id: rawUpiId,
    merchant_name: merchantName,
    qr_image_url: qrImageUrl,
    updated_at: new Date().toISOString(),
  };

  savePersistedPaymentSettings(updated);
  res.json({
    success: true,
    message: 'Payment QR saved successfully.',
    settings: livePaymentSettings,
  });
});

/**
 * Owner-authenticated Payment QR Image upload (PNG/JPG/JPEG/WEBP <= 5 MB -> /uploads/qr_<hex>.<ext>).
 */
app.post('/api/owner/upload-payment-qr', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const body = req.body as { dataUrl?: unknown };
  if (typeof body.dataUrl !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid payment QR image payload.' });
    return;
  }

  const match = body.dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    res.status(400).json({
      success: false,
      error: 'Only PNG, JPG, JPEG, and WEBP QR images are supported.',
    });
    return;
  }

  const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length < 100 || buffer.length > 5 * 1024 * 1024) {
    res.status(400).json({ success: false, error: 'QR image size must be under 5 MB.' });
    return;
  }

  const filename = `qr_${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const targetPath = path.resolve(UPLOADS_DIR, filename);
  if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(400).json({ success: false, error: 'Invalid upload destination.' });
    return;
  }

  fs.writeFileSync(targetPath, buffer);
  res.json({ success: true, url: `/uploads/${filename}` });
});

/**
 * Owner-authenticated delete of current uploaded QR reference (does NOT delete older bill snapshots).
 */
app.delete('/api/owner/payment-qr', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const nextSettings: PaymentSettings = {
    ...livePaymentSettings,
    qr_image_url: '',
    payment_mode: livePaymentSettings.upi_id ? 'dynamic_upi' : 'uploaded_qr',
    updated_at: new Date().toISOString(),
  };
  savePersistedPaymentSettings(nextSettings);
  res.json({
    success: true,
    message: 'Uploaded payment QR removed.',
    settings: livePaymentSettings,
  });
});

/**
 * Server-side High-Resolution Main Website QR PNG Download (`/menu`).
 */
app.get('/api/tables/main/qr.png', async (req, res) => {
  try {
    const origin = resolvePublicOrigin(req);
    const menuUrl = `${origin}/menu`;
    const pngBuffer = await QRCode.toBuffer(menuUrl, {
      type: 'png',
      width: 900,
      margin: 5,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    const filename = 'RikZen-Main-Website-QR.png';
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pngBuffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pngBuffer);
  } catch (err) {
    console.error('[RikZen Main Website QR PNG Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate Main Website QR PNG.' });
  }
});

/**
 * Server-side High-Resolution Single Table QR PNG Download (Tables 1–6).
 */
app.get('/api/tables/:tableNumber/qr.png', async (req, res) => {
  try {
    const tableNumber = Number(req.params.tableNumber);
    if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 6) {
      res.status(400).json({ success: false, error: 'Table number must be between 1 and 6.' });
      return;
    }

    const origin = resolvePublicOrigin(req);
    const tableUrl = `${origin}/menu?table=${tableNumber}`;
    const pngBuffer = await QRCode.toBuffer(tableUrl, {
      type: 'png',
      width: 900,
      margin: 5,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    const filename = `RikZen-Table-${tableNumber}-QR.png`;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pngBuffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pngBuffer);
  } catch (err) {
    console.error('[RikZen Table QR PNG Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate Table QR PNG.' });
  }
});

/**
 * Server-side All-6-Tables QR ZIP Archive Download (`RikZen-Fast-Food-Table-QRs.zip`).
 * Contains `RikZen-Table-1-QR.png` ... `RikZen-Table-6-QR.png` + `RikZen-Main-Website-QR.png`.
 */
app.get('/api/tables/qr-zip', async (req, res) => {
  try {
    const origin = resolvePublicOrigin(req);
    const zip = new JSZip();

    for (let tableNumber = 1; tableNumber <= 6; tableNumber += 1) {
      const tableUrl = `${origin}/menu?table=${tableNumber}`;
      const pngBuffer = await QRCode.toBuffer(tableUrl, {
        type: 'png',
        width: 900,
        margin: 5,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      zip.file(`RikZen-Table-${tableNumber}-QR.png`, pngBuffer);
    }

    const mainPngBuffer = await QRCode.toBuffer(`${origin}/menu`, {
      type: 'png',
      width: 900,
      margin: 5,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    zip.file('RikZen-Main-Website-QR.png', mainPngBuffer);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="RikZen-Fast-Food-Table-QRs.zip"');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(zipBuffer);
  } catch (err) {
    console.error('[RikZen Table QR ZIP Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate Table QRs ZIP.' });
  }
});

/**
 * Owner-authenticated config check (never leaks secrets).
 */
app.get('/api/owner/config-status', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }
  const voiceTtsConfigured = Boolean(
    process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY',
  );
  res.json({
    success: true,
    voiceTtsConfigured,
    paymentMode: livePaymentSettings.payment_mode,
    paymentConfigured:
      livePaymentSettings.payment_mode === 'uploaded_qr'
        ? Boolean(livePaymentSettings.qr_image_url)
        : isValidUpiId(livePaymentSettings.upi_id),
  });
});

/**
 * Owner-authenticated Natural Indian Female Voice Order Announcement TTS.
 * Uses Gemini 3.8 Flash Lite TTS server-side and returns clean 24kHz audio/wav.
 */
app.post('/api/owner/voice-alert-tts', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const body = req.body as { text?: unknown; speed?: unknown };
  const rawText = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (rawText.length < 5 || rawText.length > 900) {
    res.status(400).json({
      success: false,
      error: 'Announcement text must be between 5 and 900 characters.',
    });
    return;
  }

  const speed =
    body.speed === 'slow' || body.speed === 'fast' || body.speed === 'normal'
      ? body.speed
      : 'normal';

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      success: false,
      code: 'VOICE_TTS_NOT_CONFIGURED',
      error: 'Server natural voice TTS is not configured; falling back to browser Indian voice.',
    });
    return;
  }

  const paceInstruction =
    speed === 'slow'
      ? 'Speak slowly and deliberately with clear gentle pauses between sentences.'
      : speed === 'fast'
        ? 'Speak clearly at a brisk, crisp, polite counter pace with short natural pauses.'
        : 'Speak at a calm, comfortable medium pace with natural polite pauses between sentences.';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: rawText,
              speechMetadata: {
                style: `Warm, polite, natural Indian English female restaurant staff announcing a new order in a modern cafe. Authentic soft Indian English pronunciation, clear, welcoming, never robotic or rushed. ${paceInstruction}`,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(502).json({
        success: false,
        error: 'Voice TTS returned empty audio payload.',
      });
      return;
    }

    const wavBuffer = Buffer.from(base64Audio, 'base64');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wavBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(wavBuffer);
  } catch (err) {
    console.error('[RikZen Voice TTS Error]', err);
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unable to synthesize voice alert audio.',
    });
  }
});



/**
 * Owner-authenticated sync of Firestore Menu Items & Offers into the server pricing engine.
 */
app.post('/api/catalog/sync', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const body = req.body as { items?: MenuItem[]; offers?: OfferRecord[] };

  if (Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 200) {
    liveMenuMap.clear();
    for (const item of body.items) {
      if (
        item &&
        typeof item.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
        typeof item.name === 'string' &&
        typeof item.price === 'number' &&
        item.price >= 1 &&
        item.price <= 20000
      ) {
        const offerPrice =
          typeof item.offer_price === 'number' && item.offer_price > 0 && item.offer_price < item.price
            ? item.offer_price
            : 0;
        liveMenuMap.set(item.id, {
          ...item,
          offer_price: offerPrice,
          available: Boolean(item.available),
        });
      }
    }
  }

  if (Array.isArray(body.offers) && body.offers.length <= 100) {
    liveOfferMap.clear();
    for (const offer of body.offers) {
      if (
        offer &&
        typeof offer.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,64}$/.test(offer.id) &&
        typeof offer.title === 'string' &&
        typeof offer.regular_price === 'number' &&
        typeof offer.offer_price === 'number' &&
        offer.offer_price >= 1 &&
        offer.offer_price < offer.regular_price
      ) {
        liveOfferMap.set(offer.id, {
          ...offer,
          active: Boolean(offer.active),
        });
      }
    }
  }

  res.json({
    success: true,
    synced: true,
    menuCount: liveMenuMap.size,
    offerCount: liveOfferMap.size,
  });
});

/**
 * Owner-authenticated safe dish photo upload (base64 data URI -> confined /uploads/<hex>.<ext>).
 */
app.post('/api/owner/upload-image', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }

  const body = req.body as { dataUrl?: unknown };
  if (typeof body.dataUrl !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid image payload.' });
    return;
  }

  const match = body.dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    res.status(400).json({ success: false, error: 'Only JPEG, PNG, and WebP images are supported.' });
    return;
  }

  const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length < 100 || buffer.length > 2 * 1024 * 1024) {
    res.status(400).json({ success: false, error: 'Image size must be under 2 MB.' });
    return;
  }

  const filename = `dish_${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const targetPath = path.resolve(UPLOADS_DIR, filename);
  if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
    res.status(400).json({ success: false, error: 'Invalid upload destination.' });
    return;
  }

  fs.writeFileSync(targetPath, buffer);
  res.json({ success: true, url: `/uploads/${filename}` });
});

/**
 * Authoritative Server-Side Order Verification, Customer Mobile Validation,
 * Idempotency Protection (prevents duplicate orders), Offer Discount Calculation,
 * and Cryptographic Signing. Bill PDF + QR Snapshot is generated upon Owner Confirmation.
 */
app.post('/api/orders/verify', async (req, res) => {
  try {
    pruneOrderIdempotencyCache();
    const body = req.body as {
      tableNumber?: unknown;
      customerName?: unknown;
      customerMobile?: unknown;
      customerSessionId?: unknown;
      clientRequestId?: unknown;
      items?: unknown;
      notes?: unknown;
    };

    const tableNumber = Number(body.tableNumber);
    if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 6) {
      res.status(400).json({
        success: false,
        error: 'Invalid table number. Only Table 1 through Table 6 are supported.',
      });
      return;
    }

    const customerName = typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 80) : '';
    if (customerName.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Please enter your name (at least 2 characters).',
      });
      return;
    }

    const normalizedMobile = normalizeIndianMobile(body.customerMobile);
    if (!normalizedMobile) {
      res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number.' });
      return;
    }

    const customerSessionId = typeof body.customerSessionId === 'string' ? body.customerSessionId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(customerSessionId)) {
      res.status(400).json({ success: false, error: 'Invalid customer session identifier.' });
      return;
    }

    const clientRequestId =
      typeof body.clientRequestId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(body.clientRequestId.trim())
        ? body.clientRequestId.trim()
        : '';

    if (clientRequestId) {
      const idempKey = `${customerSessionId}:${clientRequestId}`;
      const cached = orderIdempotencyCache.get(idempKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ ...cached.payload, idempotent_replay: true });
        return;
      }
    }

    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
      res.status(400).json({ success: false, error: 'Order must contain between 1 and 20 items.' });
      return;
    }

    const mergedLines = new Map<string, { kind: 'menu' | 'offer'; quantity: number }>();
    for (const rawItem of body.items as RequestedLine[]) {
      const id = typeof rawItem?.id === 'string' ? rawItem.id.trim() : '';
      const kind: 'menu' | 'offer' = rawItem?.kind === 'offer' ? 'offer' : 'menu';
      const quantity = Number(rawItem?.quantity);

      if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        res.status(400).json({ success: false, error: 'Invalid menu item identifier.' });
        return;
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        res.status(400).json({ success: false, error: 'Item quantity must be an integer between 1 and 20.' });
        return;
      }

      const key = `${kind}:${id}`;
      const existingLine = mergedLines.get(key);
      const nextQty = (existingLine?.quantity || 0) + quantity;
      if (nextQty > 20) {
        res.status(400).json({ success: false, error: 'Maximum quantity per item is 20.' });
        return;
      }
      mergedLines.set(key, { kind, quantity: nextQty });
    }

    const verifiedItems: OrderLineItem[] = [];
    let subtotal = 0;
    let total = 0;
    let itemCount = 0;

    for (const [compoundKey, entry] of mergedLines.entries()) {
      const id = compoundKey.split(':')[1];
      if (entry.kind === 'offer') {
        const offer = liveOfferMap.get(id);
        if (!offer || !offer.active) {
          res.status(400).json({ success: false, error: `Offer "${offer?.title || id}" is no longer active.` });
          return;
        }
        const regularPrice = Math.round(offer.regular_price);
        const unitPrice = Math.round(offer.offer_price);
        const lineTotal = unitPrice * entry.quantity;
        subtotal += regularPrice * entry.quantity;
        total += lineTotal;
        itemCount += entry.quantity;

        verifiedItems.push({
          menu_item_id: offer.id,
          name: offer.title,
          regular_price: regularPrice,
          unit_price: unitPrice,
          quantity: entry.quantity,
          line_total: lineTotal,
        });
      } else {
        const catalogItem = liveMenuMap.get(id);
        if (!catalogItem || !catalogItem.available) {
          res.status(400).json({ success: false, error: `${catalogItem?.name || id} is currently unavailable.` });
          return;
        }
        const regularPrice = Math.round(catalogItem.price);
        const hasOffer = catalogItem.offer_price > 0 && catalogItem.offer_price < catalogItem.price;
        const unitPrice = hasOffer ? Math.round(catalogItem.offer_price) : regularPrice;
        const lineTotal = unitPrice * entry.quantity;
        subtotal += regularPrice * entry.quantity;
        total += lineTotal;
        itemCount += entry.quantity;

        verifiedItems.push({
          menu_item_id: catalogItem.id,
          name: catalogItem.name,
          regular_price: regularPrice,
          unit_price: unitPrice,
          quantity: entry.quantity,
          line_total: lineTotal,
        });
      }
    }

    const discount = Math.max(0, subtotal - total);
    if (itemCount < 1 || itemCount > 100 || subtotal < 1 || subtotal > 50000 || total < 1) {
      res.status(400).json({ success: false, error: 'Order limits exceeded.' });
      return;
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 200) : '';
    const tableId = `table_${tableNumber}`;
    const orderId = `ord_${crypto.randomBytes(16).toString('hex')}`;
    currentOrderSequence += 1;
    const orderNumber = currentOrderSequence;
    const orderCode = `RK${orderNumber}`;
    const publicBillId = `${orderCode}-${crypto.randomBytes(6).toString('hex')}`;

    const signable: SignableOrderPayload = {
      id: orderId,
      order_number: orderNumber,
      order_code: orderCode,
      table_id: tableId,
      table_number: tableNumber,
      customer_name: customerName,
      customer_mobile: normalizedMobile,
      items: verifiedItems,
      subtotal,
      discount,
      total,
      customer_session_id: customerSessionId,
    };

    const serverSignature = computeOrderSignature(signable);
    const upiUri =
      livePaymentSettings.payment_mode === 'dynamic_upi'
        ? buildDynamicUpiUri({
            upiId: livePaymentSettings.upi_id,
            merchantName: livePaymentSettings.merchant_name,
            amount: total,
            orderCode,
            tableNumber,
          })
        : '';

    const responsePayload: Record<string, unknown> = {
      success: true,
      ...signable,
      item_count: itemCount,
      status: 'pending',
      payment_status: 'pending',
      paid_at: '',
      confirmed_at: '',
      public_bill_id: publicBillId,
      bill_page_url: `/bill/${publicBillId}`,
      payment_qr_snapshot: null,
      upi_uri: upiUri,
      pdf_ready: false,
      bill_status: 'not_generated',
      pdf_url: '',
      pdf_path: '',
      generated_at: '',
      server_signature: serverSignature,
      notes,
    };

    if (clientRequestId) {
      orderIdempotencyCache.set(`${customerSessionId}:${clientRequestId}`, {
        expiresAt: Date.now() + ORDER_IDEMPOTENCY_TTL_MS,
        payload: responsePayload,
      });
    }

    res.json(responsePayload);
  } catch (err) {
    console.error('[RikZen Order Verify Error]', err);
    res.status(500).json({
      success: false,
      error: 'Unable to place your order right now. Please try again.',
    });
  }
});

/**
 * Unified Bill Generation & Storage Endpoint (always returns strict JSON).
 */
app.post('/api/bills/generate', async (req, res) => {
  try {
    const body = req.body as {
      order?: BillOrderRequest;
      forceRegenerate?: boolean;
    };
    const ord = body?.order;
    if (!ord || !ord.id) {
      res.status(400).json({
        success: false,
        ok: false,
        error: 'Order details are required to generate the PDF bill.',
      });
      return;
    }

    const orderCode = (ord.order_code || `RK${ord.order_number}`).toUpperCase();
    const normalizedSignable: SignableOrderPayload = {
      id: ord.id,
      order_number: Number(ord.order_number),
      order_code: orderCode,
      table_id: ord.table_id || `table_${ord.table_number}`,
      table_number: Number(ord.table_number),
      customer_name: ord.customer_name || 'Guest',
      customer_mobile: ord.customer_mobile || '',
      items: Array.isArray(ord.items)
        ? ord.items.map((line) => ({
            menu_item_id: line.menu_item_id,
            name: line.name,
            regular_price: line.regular_price ?? line.unit_price,
            unit_price: line.unit_price,
            quantity: line.quantity,
            line_total: line.line_total,
          }))
        : [],
      subtotal: Number(ord.subtotal),
      discount: Number(ord.discount ?? 0),
      total: Number(ord.total),
      customer_session_id: ord.customer_session_id || '',
    };

    const sigValid = verifyOrderSignature(normalizedSignable, ord.server_signature);
    const owner = sigValid ? null : await verifyOwnerIdToken(req.headers.authorization);

    if (!sigValid && !owner) {
      res.status(403).json({
        success: false,
        ok: false,
        error: 'Bill integrity verification failed.',
      });
      return;
    }

    const authoritative = computeAuthoritativeBillAmounts(normalizedSignable.items, sigValid);

    const stored = await ensureStoredBillPdf(
      {
        orderId: normalizedSignable.id,
        orderCode,
        tableNumber: normalizedSignable.table_number,
        customerName: normalizedSignable.customer_name,
        customerMobile: normalizedSignable.customer_mobile,
        items: authoritative.items,
        subtotal: authoritative.subtotal,
        discount: authoritative.discount,
        total: authoritative.total,
        notes: ord.notes || '',
        createdAtIso: ord.created_at_iso || new Date().toISOString(),
        confirmedAt: ord.confirmed_at || undefined,
        status: ord.status || 'accepted',
        paymentStatus: ord.payment_status || 'pending',
        publicBillId: ord.public_bill_id || undefined,
        existingQrSnapshot: ord.payment_qr_snapshot || null,
      },
      { forceRegenerate: Boolean(body.forceRegenerate) },
    );

    res.json({
      success: true,
      ok: true,
      message: 'PDF generated successfully',
      order_id: stored.orderId,
      order_code: stored.orderCode,
      public_bill_id: stored.publicBillId,
      bill_page_url: stored.billPageUrl,
      filename: stored.filename,
      bill_status: 'generated',
      pdfUrl: stored.pdfUrl,
      pdf_url: stored.pdfUrl,
      pdf_path: stored.pdfPath,
      generated_at: stored.generatedAt,
      size_bytes: stored.sizeBytes,
      upi_uri: stored.upiUri,
      upi_id: stored.upiId,
      payment_qr_snapshot: stored.paymentQrSnapshot,
    });
  } catch (err) {
    console.error('[RikZen Bill Generation Error]', err);
    res.status(500).json({
      success: false,
      ok: false,
      error: err instanceof Error ? err.message : 'PDF generation failed.',
    });
  }
});

/**
 * Compatibility route so any cached client calling POST /api/bills/pdf receives a real stored PDF
 * or clean JSON error (never HTML!).
 */
app.post('/api/bills/pdf', async (req, res) => {
  try {
    const body = req.body as { order?: BillOrderRequest };
    const ord = body?.order;
    if (!ord || !ord.id) {
      res.status(400).json({ success: false, error: 'Verified order data is required.' });
      return;
    }

    const orderCode = (ord.order_code || `RK${ord.order_number}`).toUpperCase();
    const normalizedSignable: SignableOrderPayload = {
      id: ord.id,
      order_number: Number(ord.order_number),
      order_code: orderCode,
      table_id: ord.table_id || `table_${ord.table_number}`,
      table_number: Number(ord.table_number),
      customer_name: ord.customer_name || 'Guest',
      customer_mobile: ord.customer_mobile || '',
      items: Array.isArray(ord.items)
        ? ord.items.map((line) => ({
            menu_item_id: line.menu_item_id,
            name: line.name,
            regular_price: line.regular_price ?? line.unit_price,
            unit_price: line.unit_price,
            quantity: line.quantity,
            line_total: line.line_total,
          }))
        : [],
      subtotal: Number(ord.subtotal),
      discount: Number(ord.discount ?? 0),
      total: Number(ord.total),
      customer_session_id: ord.customer_session_id || '',
    };

    const sigValid = verifyOrderSignature(normalizedSignable, ord.server_signature);
    const owner = sigValid ? null : await verifyOwnerIdToken(req.headers.authorization);
    if (!sigValid && !owner) {
      res.status(403).json({ success: false, error: 'Bill integrity verification failed.' });
      return;
    }

    const authoritative = computeAuthoritativeBillAmounts(normalizedSignable.items, sigValid);
    const stored = await ensureStoredBillPdf({
      orderId: normalizedSignable.id,
      orderCode,
      tableNumber: normalizedSignable.table_number,
      customerName: normalizedSignable.customer_name,
      customerMobile: normalizedSignable.customer_mobile,
      items: authoritative.items,
      subtotal: authoritative.subtotal,
      discount: authoritative.discount,
      total: authoritative.total,
      notes: ord.notes || '',
      createdAtIso: ord.created_at_iso || new Date().toISOString(),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${stored.filename}"`);
    res.setHeader('Content-Length', String(stored.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(stored.absolutePath).pipe(res);
  } catch (err) {
    console.error('[RikZen Bill PDF Route Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate PDF bill.' });
  }
});

/**
 * Real Stored PDF File Endpoint (for Browser View Tab, Embedded Viewer, and Direct Download).
 */
app.get('/api/bills/file/:orderId/:filename', (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const filename = String(req.params.filename || '').trim();
    const sig = typeof req.query.sig === 'string' ? req.query.sig.trim() : '';
    const forceDownload = req.query.download === '1' || req.query.download === 'true';

    if (!/^ord_[a-zA-Z0-9_-]{20,120}$/.test(orderId)) {
      res.status(400).json({ success: false, error: 'Invalid order identifier.' });
      return;
    }
    if (!/^RikZen-Fast-Food-Bill-RK[0-9]{4,8}\.pdf$/.test(filename)) {
      res.status(400).json({ success: false, error: 'Invalid PDF filename.' });
      return;
    }
    if (!verifyBillFileToken(orderId, filename, sig)) {
      res.status(403).json({ success: false, error: 'Unauthorized PDF access link.' });
      return;
    }

    const orderDir = path.resolve(BILLS_DIR, orderId);
    if (!orderDir.startsWith(BILLS_DIR + path.sep)) {
      res.status(400).json({ success: false, error: 'Invalid storage path.' });
      return;
    }
    const absolutePath = path.resolve(orderDir, filename);
    if (!absolutePath.startsWith(orderDir + path.sep)) {
      res.status(400).json({ success: false, error: 'Invalid file path.' });
      return;
    }

    const inspection = inspectStoredPdf(absolutePath);
    if (!inspection.valid) {
      res.status(404).json({
        success: false,
        error: 'Stored PDF bill was not found on server. Please regenerate.',
        code: 'PDF_MISSING',
      });
      return;
    }

    const dispositionType = forceDownload ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    res.setHeader('Content-Length', String(inspection.size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');

    const stream = fs.createReadStream(absolutePath);
    stream.on('error', (streamErr) => {
      console.error('[RikZen PDF Stream Error]', streamErr);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to read stored PDF bill.' });
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[RikZen PDF Serve Error]', err);
    res.status(500).json({ success: false, error: 'Failed to serve PDF bill.' });
  }
});

/**
 * Website-Native Public Bill Endpoint (`/api/public/bills/:billId`).
 * Zero customer login required; survives page refresh; exposes ONLY this customer's
 * sanitized bill & immutable Payment QR snapshot (no admin data, no other orders).
 */
app.get('/api/public/bills/:billId', (req, res) => {
  try {
    const billId = String(req.params.billId || '').trim();
    if (!/^RK[0-9]{4,8}-[a-fA-F0-9]{8,24}$/.test(billId)) {
      res.status(404).json({
        success: false,
        error: 'Bill not found. Please check the bill link or ask at the counter.',
      });
      return;
    }

    const record = readPublicBillRecord(billId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: 'Bill not found or not yet confirmed by the restaurant.',
      });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      bill: {
        public_bill_id: record.public_bill_id,
        order_code: record.order_code,
        table_number: record.table_number,
        customer_name: record.customer_name,
        customer_mobile: record.customer_mobile,
        items: record.items,
        subtotal: record.subtotal,
        discount: record.discount,
        total: record.total,
        notes: record.notes,
        status: record.status,
        payment_status: record.payment_status,
        created_at_iso: record.created_at_iso,
        confirmed_at: record.confirmed_at,
        generated_at: record.generated_at,
        pdf_url: record.pdf_url,
        filename: record.filename,
        payment_qr_snapshot: record.payment_qr_snapshot,
      },
    });
  } catch (err) {
    console.error('[RikZen Public Bill Read Error]', err);
    res.status(500).json({
      success: false,
      error: 'Unable to load this bill right now. Please try again.',
    });
  }
});

/**
 * Owner-authenticated Real Sales Report PDF Endpoint (Daily / Weekly / Monthly / Custom).
 * Strictly sums ONLY verified completed orders on the backend.
 */
app.post('/api/reports/pdf', async (req, res) => {
  try {
    const owner = await verifyOwnerIdToken(req.headers.authorization);
    if (!owner) {
      res.status(401).json({ success: false, error: 'Owner authentication required.' });
      return;
    }

    const body = req.body as {
      reportType?: unknown;
      periodLabel?: unknown;
      filename?: unknown;
      orders?: unknown;
    };

    const reportType =
      body.reportType === 'daily' ||
      body.reportType === 'weekly' ||
      body.reportType === 'monthly' ||
      body.reportType === 'custom'
        ? body.reportType
        : 'daily';

    const periodLabel =
      typeof body.periodLabel === 'string' && body.periodLabel.trim()
        ? body.periodLabel.trim().slice(0, 80)
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const rawFilename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const safeFilename = /^RikZen-(Daily|Weekly|Monthly|Custom)-Report-[0-9A-Za-z_-]{4,32}\.pdf$/.test(
      rawFilename,
    )
      ? rawFilename
      : `RikZen-${reportType[0].toUpperCase()}${reportType.slice(1)}-Report-${new Date().toISOString().slice(0, 10)}.pdf`;

    const rawOrders = Array.isArray(body.orders) ? body.orders.slice(0, 2000) : [];
    const sanitizedOrders: SalesReportOrderRow[] = rawOrders
      .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === 'object'))
      .map((o) => ({
        order_code: String(o.order_code || `RK${o.order_number || 1000}`).slice(0, 16),
        customer_name: String(o.customer_name || 'Guest').slice(0, 80),
        table_number: Math.max(1, Math.min(6, Number(o.table_number || 1))),
        total: Math.max(0, Math.min(500000, Number(o.total || 0))),
        status: String(o.status || 'pending'),
        created_at_iso:
          typeof o.created_at_iso === 'string' && o.created_at_iso.trim()
            ? o.created_at_iso
            : new Date().toISOString(),
      }));

    const pdfBuffer = await generateSalesReportPdfBuffer({
      reportType,
      periodLabel,
      orders: sanitizedOrders,
      generatedAtIso: new Date().toISOString(),
    });

    if (pdfBuffer.length < 512 || pdfBuffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
      res.status(500).json({ success: false, error: 'Sales report PDF generation failed.' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[RikZen Sales Report PDF Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate sales report PDF.' });
  }
});

/**
 * STRICT JSON GUARANTEE FOR ALL /api/* ROUTES:
 * Never fall through to Vite SPA index.html or Express HTML error pages!
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.error('[RikZen API Error Middleware]', err);
    const statusCode =
      typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message =
      statusCode === 400
        ? 'Invalid JSON request payload.'
        : err instanceof Error
          ? err.message
          : 'Unexpected server error.';
    res.status(statusCode).json({
      success: false,
      error: message,
    });
    return;
  }
  next(err);
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({
          success: false,
          error: `API route not found: ${req.method} ${req.originalUrl}`,
        });
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RikZen Fast Food server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
