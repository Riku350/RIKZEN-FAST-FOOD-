export type MenuCategoryId =
  | 'rolls'
  | 'burgers'
  | 'snacks'
  | 'chicken'
  | 'fast_food'
  | 'drinks'
  | 'lassi'
  | 'desserts'
  | 'special';

export interface MenuCategoryMeta {
  id: MenuCategoryId;
  label: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: MenuCategoryId;
  description: string;
  price: number;
  offer_price: number; // 0 when no offer is active
  image: string;
  available: boolean;
  is_veg: boolean;
  featured: boolean;
  prep_minutes?: number;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface OfferRecord {
  id: string;
  title: string;
  description: string;
  image: string;
  regular_price: number;
  offer_price: number;
  active: boolean;
  created_at?: unknown;
  updated_at?: unknown;
}

export type TableStatus = 'available' | 'ordering' | 'preparing' | 'ready' | 'bill_requested';

export interface TableRecord {
  id: string;
  table_number: number;
  qr_code: string;
  status: TableStatus;
  active_order_id: string;
  updated_at?: unknown;
}

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'bill_requested'
  | 'bill_ready'
  | 'completed'
  | 'rejected';

export type BillStatus =
  | 'not_generated'
  | 'generating'
  | 'generated'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'retrying';

export type WhatsAppDeliveryStatus = 'not_sent' | 'sending' | 'retrying' | 'sent' | 'failed';

export type PaymentStatus = 'not_paid' | 'pending' | 'paid' | 'failed';

export interface PaymentSettings {
  id: 'payment';
  upi_id: string;
  merchant_name: string;
  qr_image_url: string;
  updated_at?: unknown;
}

export interface OrderLineItem {
  menu_item_id: string;
  name: string;
  regular_price: number;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface CustomerDetails {
  name: string;
  mobileDigits: string; // 10-digit Indian mobile number without +91
  notes: string;
}

export interface OrderRecord {
  id: string;
  order_number: number;
  order_code: string; // e.g. RK1024
  table_id: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string; // +91XXXXXXXXXX
  items: OrderLineItem[];
  item_count: number;
  subtotal: number;
  discount: number;
  total: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  paid_at: string;
  upi_uri: string;
  pdf_ready: boolean;
  bill_status: BillStatus;
  pdf_url: string;
  pdf_path: string;
  generated_at: string;
  sent_at: string;
  send_status: WhatsAppDeliveryStatus;
  whatsapp_status: WhatsAppDeliveryStatus;
  whatsapp_error: string;
  customer_session_id: string;
  server_signature: string;
  notes: string;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface CartItem {
  id: string;
  kind: 'menu' | 'offer';
  name: string;
  image: string;
  regularPrice: number;
  effectivePrice: number;
  quantity: number;
}

export interface VerifiedOrderQuote {
  id: string;
  order_number: number;
  order_code: string;
  table_id: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string;
  items: OrderLineItem[];
  item_count: number;
  subtotal: number;
  discount: number;
  total: number;
  status: 'pending';
  payment_status: PaymentStatus;
  paid_at: string;
  upi_uri: string;
  pdf_ready: boolean;
  bill_status: BillStatus;
  pdf_url: string;
  pdf_path: string;
  generated_at: string;
  sent_at: string;
  send_status: WhatsAppDeliveryStatus;
  whatsapp_status: WhatsAppDeliveryStatus;
  whatsapp_error: string;
  customer_session_id: string;
  server_signature: string;
  notes: string;
}

export interface GeneratedBillResult {
  ok: boolean;
  order_id: string;
  order_code: string;
  filename: string;
  bill_status: BillStatus;
  pdf_url: string;
  pdf_path: string;
  upi_uri?: string;
  upi_id?: string;
  generated_at: string;
  size_bytes: number;
}

export function getEffectivePrice(item: { price: number; offer_price?: number }): number {
  const offer = Number(item.offer_price || 0);
  if (offer > 0 && offer < item.price) {
    return offer;
  }
  return item.price;
}

export function getDiscountPercent(regularPrice: number, offerPrice?: number): number {
  const offer = Number(offerPrice || 0);
  if (offer <= 0 || offer >= regularPrice || regularPrice <= 0) return 0;
  return Math.round(((regularPrice - offer) / regularPrice) * 100);
}
