import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { NextFunction, Request, Response } from 'express';
import { CANONICAL_MENU_ITEMS, CANONICAL_OFFERS } from './src/data/menuCatalog.ts';
import { generateBrandedBillPdfBuffer } from './src/lib/pdfBillGenerator.ts';
import { generateSalesReportPdfBuffer, type SalesReportOrderRow } from './src/lib/pdfReportGenerator.ts';
import type { MenuItem, OfferRecord, OrderLineItem } from './src/types/restaurant.ts';

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
    : crypto.createHash('sha256').update(`rikzen-fast-food-${FIREBASE_PROJECT_ID || 'v2'}`).digest('hex');

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
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(BILLS_DIR, { recursive: true });

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

async function safeParseProviderJson<T>(resp: globalThis.Response): Promise<{ ok: boolean; data: T | null; rawText: string }> {
  const rawText = await resp.text();
  try {
    const parsed = JSON.parse(rawText) as T;
    return { ok: true, data: parsed, rawText };
  } catch {
    return { ok: false, data: null, rawText };
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
  },
  options: { forceRegenerate?: boolean } = {},
) {
  const storage = buildBillStorageInfo(params.orderId, params.orderCode);
  const existing = inspectStoredPdf(storage.absolutePath);

  if (!options.forceRegenerate && existing.valid) {
    const stat = fs.statSync(storage.absolutePath);
    return {
      ...storage,
      generatedAt: stat.mtime.toISOString(),
      sizeBytes: existing.size,
      reused: true,
    };
  }

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

  return {
    ...storage,
    generatedAt: new Date().toISOString(),
    sizeBytes: verified.size,
    reused: false,
  };
}

interface RequestedLine {
  id: string;
  kind?: 'menu' | 'offer';
  quantity: number;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

// Serve owner-uploaded dish photos safely
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
 * Owner-authenticated config check (never leaks secrets).
 */
app.get('/api/owner/config-status', async (req, res) => {
  const owner = await verifyOwnerIdToken(req.headers.authorization);
  if (!owner) {
    res.status(401).json({ success: false, error: 'Owner authentication required.' });
    return;
  }
  const hasToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim());
  const hasPhoneId = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
  res.json({
    success: true,
    whatsappConfigured: hasToken && hasPhoneId,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  });
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
 * Offer Discount Calculation, Cryptographic Signing, AND Immediate PDF Bill Storage.
 */
app.post('/api/orders/verify', async (req, res) => {
  try {
    const body = req.body as {
      tableNumber?: unknown;
      customerName?: unknown;
      customerMobile?: unknown;
      customerSessionId?: unknown;
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
      res.status(400).json({ success: false, error: 'Please enter a valid mobile number.' });
      return;
    }

    const customerSessionId = typeof body.customerSessionId === 'string' ? body.customerSessionId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(customerSessionId)) {
      res.status(400).json({ success: false, error: 'Invalid customer session identifier.' });
      return;
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
    const nowIso = new Date().toISOString();

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

    const storedPdf = await ensureStoredBillPdf({
      orderId,
      orderCode,
      tableNumber,
      customerName,
      customerMobile: normalizedMobile,
      items: verifiedItems,
      subtotal,
      discount,
      total,
      notes,
      createdAtIso: nowIso,
    });

    res.json({
      success: true,
      ...signable,
      item_count: itemCount,
      status: 'pending',
      pdf_ready: true,
      bill_status: 'generated',
      pdf_url: storedPdf.pdfUrl,
      pdf_path: storedPdf.pdfPath,
      generated_at: storedPdf.generatedAt,
      sent_at: '',
      send_status: 'not_sent',
      whatsapp_status: 'not_sent',
      whatsapp_error: '',
      server_signature: serverSignature,
      notes,
    });
  } catch (err) {
    console.error('[RikZen Order Verify & Bill Gen Error]', err);
    res.status(500).json({
      success: false,
      error: 'Unable to verify order and generate bill. Please try again.',
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
      },
      { forceRegenerate: Boolean(body.forceRegenerate) },
    );

    res.json({
      success: true,
      ok: true,
      message: 'PDF generated successfully',
      order_id: stored.orderId,
      order_code: stored.orderCode,
      filename: stored.filename,
      bill_status: 'generated',
      pdfUrl: stored.pdfUrl,
      pdf_url: stored.pdfUrl,
      pdf_path: stored.pdfPath,
      generated_at: stored.generatedAt,
      size_bytes: stored.sizeBytes,
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
 * Owner-authenticated WhatsApp Business Cloud API PDF Bill Delivery.
 * Never fakes delivery — reports real Meta Graph API status or clean WHATSAPP_NOT_CONFIGURED JSON.
 */
app.post('/api/bills/whatsapp', async (req, res) => {
  try {
    const owner = await verifyOwnerIdToken(req.headers.authorization);
    if (!owner) {
      res.status(401).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        error: 'Owner authentication required.',
      });
      return;
    }

    const body = req.body as { order?: BillOrderRequest };
    const ord = body?.order;
    if (!ord || !ord.id) {
      res.status(400).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        error: 'Order data is required to send the bill.',
      });
      return;
    }

    const normalizedMobile = normalizeIndianMobile(ord.customer_mobile);
    if (!normalizedMobile) {
      res.status(400).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        error: 'Invalid customer mobile number. Please verify the 10-digit Indian mobile number.',
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
      customer_mobile: normalizedMobile,
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
    const authoritative = computeAuthoritativeBillAmounts(normalizedSignable.items, sigValid);

    // 1. Ensure PDF exists in persistent storage
    const stored = await ensureStoredBillPdf({
      orderId: normalizedSignable.id,
      orderCode,
      tableNumber: normalizedSignable.table_number,
      customerName: normalizedSignable.customer_name,
      customerMobile: normalizedMobile,
      items: authoritative.items,
      subtotal: authoritative.subtotal,
      discount: authoritative.discount,
      total: authoritative.total,
      notes: ord.notes || '',
      createdAtIso: ord.created_at_iso || new Date().toISOString(),
    });

    // 2. Verify WhatsApp Business API secrets on server
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';

    if (!accessToken || !phoneNumberId) {
      res.status(503).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        code: 'WHATSAPP_NOT_CONFIGURED',
        status: 'failed',
        bill_status: 'failed',
        pdf_url: stored.pdfUrl,
        pdf_path: stored.pdfPath,
        generated_at: stored.generatedAt,
        error: 'WhatsApp API is not configured.',
      });
      return;
    }

    // 3. Upload verified PDF binary to Meta Graph API /media
    const pdfBuffer = fs.readFileSync(stored.absolutePath);
    if (pdfBuffer.length < 512 || pdfBuffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
      res.status(500).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        error: 'Stored PDF file failed integrity check before WhatsApp upload.',
      });
      return;
    }

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'application/pdf');
    formData.append(
      'file',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      stored.filename,
    );

    const uploadResp = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      },
    );

    const parsedUpload = await safeParseProviderJson<{
      id?: string;
      error?: { message?: string };
    }>(uploadResp);

    if (!uploadResp.ok || !parsedUpload.data?.id) {
      const uploadErr =
        parsedUpload.data?.error?.message ||
        `WhatsApp media upload failed (HTTP ${uploadResp.status}).`;
      console.error('[RikZen WhatsApp Upload Error]', {
        status: uploadResp.status,
        error: uploadErr,
        rawSnippet: parsedUpload.rawText.slice(0, 300),
      });
      res.status(502).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        pdf_url: stored.pdfUrl,
        pdf_path: stored.pdfPath,
        generated_at: stored.generatedAt,
        error: uploadErr,
      });
      return;
    }

    // 4. Send WhatsApp Document message to customer's verified +91 mobile number
    const recipientDigits = normalizedMobile.replace(/\D/g, ''); // 91XXXXXXXXXX
    const caption = [
      `Hello ${normalizedSignable.customer_name} 👋`,
      '',
      'Thank you for ordering from RikZen Fast Food 🍔',
      '',
      `Order #${stored.orderCode}`,
      '',
      `Table: ${normalizedSignable.table_number}`,
      '',
      `Total: ₹${Math.round(authoritative.total).toLocaleString('en-IN')}`,
      '',
      'Your detailed bill is attached.',
      '',
      'Thank you for visiting RikZen Fast Food ❤️',
      '',
      'We hope to serve you again!',
    ].join('\n');

    const msgResp = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientDigits,
          type: 'document',
          document: {
            id: parsedUpload.data.id,
            filename: stored.filename,
            caption,
          },
        }),
      },
    );

    const parsedMsg = await safeParseProviderJson<{
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    }>(msgResp);

    if (!msgResp.ok || !parsedMsg.data?.messages?.[0]?.id) {
      const sendErr =
        parsedMsg.data?.error?.message ||
        `WhatsApp message delivery failed (HTTP ${msgResp.status}).`;
      console.error('[RikZen WhatsApp Send Error]', {
        status: msgResp.status,
        error: sendErr,
        rawSnippet: parsedMsg.rawText.slice(0, 300),
      });
      res.status(502).json({
        success: false,
        delivered: false,
        provider: 'whatsapp',
        status: 'failed',
        bill_status: 'failed',
        pdf_url: stored.pdfUrl,
        pdf_path: stored.pdfPath,
        generated_at: stored.generatedAt,
        error: sendErr,
      });
      return;
    }

    const sentAt = new Date().toISOString();
    res.json({
      success: true,
      delivered: true,
      provider: 'whatsapp',
      status: 'sent',
      bill_status: 'sent',
      messageId: parsedMsg.data.messages[0].id,
      sent_at: sentAt,
      pdf_url: stored.pdfUrl,
      pdf_path: stored.pdfPath,
      generated_at: stored.generatedAt,
    });
  } catch (err) {
    console.error('[RikZen WhatsApp Delivery Exception]', err);
    res.status(500).json({
      success: false,
      delivered: false,
      provider: 'whatsapp',
      status: 'failed',
      bill_status: 'failed',
      error: err instanceof Error ? err.message : 'Unexpected WhatsApp delivery failure.',
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
