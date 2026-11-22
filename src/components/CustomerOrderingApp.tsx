import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Info,
  Lock,
  Minus,
  Phone,
  Plus,
  QrCode,
  Receipt,
  Search,
  Share2,
  ShoppingBag,
  Smartphone,
  Tag,
  User as UserIcon,
  Utensils,
  XCircle,
} from 'lucide-react';
import {
  HERO_FEAST_IMAGE,
  MENU_CATEGORIES,
} from '../data/menuCatalog';
import { shareBillNative } from '../lib/billShare';
import {
  createConfirmedOrder,
  downloadOrderBillPdf,
  formatIndianMobileDisplay,
  formatRelativeTime,
  formatRupees,
  getCachedMenuItems,
  getCachedOffers,
  getSavedCustomerDetails,
  getStoredOrderIdForTable,
  isValidIndianMobileDigits,
  requestOrderBill,
  saveCustomerDetailsLocally,
  setStoredOrderIdForTable,
  subscribeToMenuItems,
  subscribeToOffers,
  subscribeToOrder,
  subscribeToPaymentSettings,
  toCustomerFriendlyError,
  verifyOrderOnServer,
} from '../lib/orderService';
import { buildDynamicUpiUri, DEFAULT_PAYMENT_SETTINGS } from '../lib/upiPayment';
import {
  CartItem,
  CustomerDetails,
  getDiscountPercent,
  getEffectivePrice,
  MenuCategoryId,
  MenuItem,
  OfferRecord,
  OrderRecord,
  PaymentSettings,
} from '../types/restaurant';
import { AmbientFoodBackdrop } from './AmbientFoodBackdrop';
import { BillPreviewModal } from './BillPreviewModal';
import { FoodArtIcon } from './FoodArtIcons';
import { FoodImage } from './FoodImage';
import { ThankYouScreen } from './ThankYouScreen';

interface CustomerOrderingAppProps {
  tableNumber: number;
  onNavigate: (path: string) => void;
}

type CustomerTab = 'menu' | 'cart' | 'order' | 'info';
type CheckoutStage = 'cart' | 'details' | 'review';

const CATEGORY_LABEL_MAP: Record<MenuCategoryId, string> = Object.fromEntries(
  MENU_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<MenuCategoryId, string>;

export const CustomerOrderingApp: React.FC<CustomerOrderingAppProps> = ({
  tableNumber,
  onNavigate,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<CustomerTab>('menu');
  const [checkoutStage, setCheckoutStage] = useState<CheckoutStage>('cart');
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => getCachedMenuItems());
  const [offers, setOffers] = useState<OfferRecord[]>(() => getCachedOffers());
  const [selectedCategory, setSelectedCategory] = useState<MenuCategoryId | 'all'>('all');
  const [vegOnly, setVegOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Cart state keyed by `menu:<id>` or `offer:<id>`
  const [cart, setCart] = useState<Record<string, number>>({});
  const [justAddedKeys, setJustAddedKeys] = useState<Record<string, boolean>>({});
  const justAddedTimersRef = useRef<Record<string, number>>({});
  const [customerDetails, setCustomerDetails] = useState<CustomerDetails>(() =>
    getSavedCustomerDetails(),
  );
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const checkoutRequestIdRef = useRef<string>('');

  // Active real-time order state
  const [activeOrderId, setActiveOrderId] = useState<string | null>(() =>
    getStoredOrderIdForTable(tableNumber),
  );
  const [activeOrder, setActiveOrder] = useState<OrderRecord | null>(null);
  const [orderSyncError, setOrderSyncError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isRequestingBill, setIsRequestingBill] = useState(false);
  const [showThankYouManual, setShowThankYouManual] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const stored = getStoredOrderIdForTable(tableNumber);
    setActiveOrderId(stored);
    setActiveOrder(null);
    setShowThankYouManual(false);
  }, [tableNumber]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubMenu = subscribeToMenuItems((items) => setMenuItems(items));
    const unsubOffers = subscribeToOffers((list) => setOffers(list));
    const unsubPayment = subscribeToPaymentSettings((settings) => setPaymentSettings(settings));
    return () => {
      unsubMenu();
      unsubOffers();
      unsubPayment();
    };
  }, []);

  useEffect(() => {
    if (!activeOrderId) {
      setActiveOrder(null);
      return;
    }
    setOrderSyncError(null);
    const unsub = subscribeToOrder(
      activeOrderId,
      (order) => {
        setActiveOrder(order);
        if (!order) {
          setStoredOrderIdForTable(tableNumber, null);
          setActiveOrderId(null);
        }
      },
      (err) => {
        console.error('[Customer Order Sync Error]', err);
        setOrderSyncError(toCustomerFriendlyError(err));
      },
    );
    return () => unsub();
  }, [activeOrderId, tableNumber]);

  const activeOffers = useMemo(() => offers.filter((o) => o.active), [offers]);

  const menuMap = useMemo(
    () => Object.fromEntries(menuItems.map((m) => [m.id, m])),
    [menuItems],
  );
  const offerMap = useMemo(
    () => Object.fromEntries(offers.map((o) => [o.id, o])),
    [offers],
  );

  const cartList: CartItem[] = useMemo(() => {
    const list: CartItem[] = [];
    for (const [key, quantity] of Object.entries(cart)) {
      if (quantity <= 0) continue;
      if (key.startsWith('offer:')) {
        const id = key.slice(6);
        const offer = offerMap[id];
        if (offer && offer.active) {
          list.push({
            id: offer.id,
            kind: 'offer',
            name: offer.title,
            image: offer.image,
            regularPrice: offer.regular_price,
            effectivePrice: offer.offer_price,
            quantity,
          });
        }
      } else {
        const id = key.startsWith('menu:') ? key.slice(5) : key;
        const item = menuMap[id];
        if (item && item.available) {
          list.push({
            id: item.id,
            kind: 'menu',
            name: item.name,
            image: item.image,
            regularPrice: item.price,
            effectivePrice: getEffectivePrice(item),
            quantity,
          });
        }
      }
    }
    return list;
  }, [cart, menuMap, offerMap]);

  const cartItemCount = useMemo(
    () => cartList.reduce((acc, entry) => acc + entry.quantity, 0),
    [cartList],
  );

  const cartSubtotal = useMemo(
    () => cartList.reduce((acc, entry) => acc + entry.regularPrice * entry.quantity, 0),
    [cartList],
  );

  const cartTotal = useMemo(
    () => cartList.reduce((acc, entry) => acc + entry.effectivePrice * entry.quantity, 0),
    [cartList],
  );

  const cartDiscount = Math.max(0, cartSubtotal - cartTotal);

  const filteredMenu = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (vegOnly && !item.is_veg) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [menuItems, selectedCategory, vegOnly, searchQuery]);

  useEffect(() => {
    const timers = justAddedTimersRef.current;
    return () => {
      for (const timerId of Object.values(timers)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const updateCartQty = (kind: 'menu' | 'offer', id: string, delta: number) => {
    // Cart changed -> fresh idempotency key for next checkout
    checkoutRequestIdRef.current = '';
    const key = `${kind}:${id}`;
    const wasEmpty = !(cart[key] > 0);
    setCart((prev) => {
      const next = Math.min(20, Math.max(0, (prev[key] || 0) + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });

    if (delta > 0 && wasEmpty) {
      if (justAddedTimersRef.current[key]) {
        window.clearTimeout(justAddedTimersRef.current[key]);
      }
      setJustAddedKeys((prev) => ({ ...prev, [key]: true }));
      justAddedTimersRef.current[key] = window.setTimeout(() => {
        setJustAddedKeys((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        delete justAddedTimersRef.current[key];
      }, 650);
    }
  };

  const handleContinueFromDetails = (e: React.FormEvent) => {
    e.preventDefault();
    setDetailsError(null);
    const trimmedName = customerDetails.name.trim();
    const cleanedDigits = customerDetails.mobileDigits.replace(/\D/g, '');

    if (trimmedName.length < 2) {
      setDetailsError('Please enter your name.');
      return;
    }
    if (!isValidIndianMobileDigits(cleanedDigits)) {
      setDetailsError('Please enter a valid 10-digit mobile number.');
      return;
    }

    const cleanDetails: CustomerDetails = {
      name: trimmedName,
      mobileDigits: cleanedDigits,
      notes: customerDetails.notes.trim().slice(0, 200),
    };
    setCustomerDetails(cleanDetails);
    saveCustomerDetailsLocally(cleanDetails);
    setCheckoutStage('review');
  };

  const handleConfirmOrder = async () => {
    if (cartList.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (!checkoutRequestIdRef.current) {
        checkoutRequestIdRef.current = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      }
      const verifiedQuote = await verifyOrderOnServer(
        tableNumber,
        cartList,
        customerDetails,
        checkoutRequestIdRef.current,
      );
      const orderId = await createConfirmedOrder(verifiedQuote);
      checkoutRequestIdRef.current = '';
      setActiveOrderId(orderId);
      setCart({});
      setCheckoutStage('cart');
      setShowThankYouManual(false);
      setActiveTab('order');
    } catch (err) {
      console.error('[Customer Place Order Error]', err);
      setSubmitError(toCustomerFriendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestBill = async () => {
    if (!activeOrder || isRequestingBill) return;
    setIsRequestingBill(true);
    setOrderSyncError(null);
    try {
      await requestOrderBill(activeOrder.id);
    } catch (err) {
      console.error('[Customer Request Bill Error]', err);
      setOrderSyncError(toCustomerFriendlyError(err));
    } finally {
      setIsRequestingBill(false);
    }
  };

  const handleDirectDownloadPdf = async () => {
    if (!activeOrder || downloadingPdf) return;
    setDownloadingPdf(true);
    setOrderSyncError(null);
    try {
      await downloadOrderBillPdf(activeOrder);
    } catch (err) {
      console.error('[Customer PDF Download Error]', err);
      setOrderSyncError(toCustomerFriendlyError(err));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleShareCustomerBill = async () => {
    if (!activeOrder) return;
    const outcome = await shareBillNative({
      order_code: activeOrder.order_code || `RK${activeOrder.order_number}`,
      table_number: activeOrder.table_number,
      customer_name: activeOrder.customer_name,
      total: activeOrder.total,
      public_bill_id: activeOrder.public_bill_id,
      pdf_url: activeOrder.pdf_url,
    });
    if (outcome.method !== 'cancelled') {
      setShareFeedback(outcome.message);
      window.setTimeout(() => {
        setShareFeedback((cur) => (cur === outcome.message ? null : cur));
      }, 3000);
    }
  };

  const handleStartNewOrder = () => {
    setStoredOrderIdForTable(tableNumber, null);
    setActiveOrderId(null);
    setActiveOrder(null);
    setShowThankYouManual(false);
    setCheckoutStage('cart');
    setActiveTab('menu');
  };

  const scrollToMenuGrid = () => {
    setActiveTab('menu');
    const el = document.getElementById('rikzen-menu-grid');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const hasLiveOrderBadge =
    activeOrder && !['completed', 'rejected'].includes(activeOrder.status);

  const activeOrderCode = activeOrder
    ? activeOrder.order_code || `RK${activeOrder.order_number}`
    : '';

  return (
    <div className="relative min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col">
      <AmbientFoodBackdrop />

      {/* Top Bar — 3-Zone Contract */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-neutral-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            RikZen <span className="text-[#E5391B]">Fast Food</span>
          </button>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600">
            <button
              type="button"
              onClick={() => setActiveTab('menu')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'menu' ? 'text-[#E5391B] font-semibold' : 'hover:text-neutral-900'
              }`}
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => {
                setCheckoutStage('cart');
                setActiveTab('cart');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                activeTab === 'cart' ? 'text-[#E5391B] font-semibold' : 'hover:text-neutral-900'
              }`}
            >
              Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('order')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'order' ? 'text-[#E5391B] font-semibold' : 'hover:text-neutral-900'
              }`}
            >
              My Order
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('info')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'info' ? 'text-[#E5391B] font-semibold' : 'hover:text-neutral-900'
              }`}
            >
              Info
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                if (cartItemCount > 0) {
                  setCheckoutStage('cart');
                  setActiveTab('cart');
                } else if (activeOrder) {
                  setActiveTab('order');
                } else {
                  scrollToMenuGrid();
                }
              }}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs sm:text-sm font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
            >
              Table {tableNumber}
              {cartItemCount > 0 ? ` · ${formatRupees(cartTotal)}` : ''}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 pb-28 md:pb-14">
        {/* ============================================================ */}
        {/* TAB 1: MENU & SPECIAL OFFERS                                 */}
        {/* ============================================================ */}
        {activeTab === 'menu' && (
          <div className="space-y-7">
            {/* Hero Banner */}
            <section className="relative rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-200">
              <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
                <div className="lg:col-span-6 p-6 sm:p-8 lg:p-10 flex flex-col justify-center bg-white">
                  <p className="text-xs sm:text-sm font-semibold text-[#E5391B] tracking-wide mb-2">
                    Seated at Table {tableNumber} · Fresh · Fast · Delicious
                  </p>
                  <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-neutral-900 leading-tight mb-3">
                    Hot rolls, crispy burgers &amp; chilled lassi served to your table.
                  </h1>
                  <p className="text-sm sm:text-base text-neutral-600 mb-6 max-w-lg leading-relaxed">
                    Tap to add dishes or combo offers. Your bill is generated automatically in your
                    name as soon as the kitchen confirms.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={scrollToMenuGrid}
                      className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#E5391B] text-white font-semibold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      Explore Menu
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    {activeOrder && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('order')}
                        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-neutral-100 text-neutral-900 font-semibold text-sm hover:bg-neutral-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Track #{activeOrderCode}
                      </button>
                    )}
                  </div>
                </div>
                <div className="lg:col-span-6 relative aspect-[16/10] lg:aspect-auto lg:min-h-[280px]">
                  <FoodImage
                    src={HERO_FEAST_IMAGE}
                    alt="RikZen Fast Food signature burger, chicken roll, fries, and mango lassi spread"
                    className="w-full h-full"
                    priority
                  />
                </div>
              </div>
            </section>

            {/* Active Combo Offers Strip */}
            {activeOffers.length > 0 && (
              <section aria-label="Special combo offers" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-extrabold text-neutral-900 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-[#E5391B]" />
                    Today&apos;s Special Offers
                  </h2>
                  <span className="text-xs font-medium text-neutral-500">
                    Auto-applied at checkout
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeOffers.map((offer) => {
                    const qty = cart[`offer:${offer.id}`] || 0;
                    const offPct = getDiscountPercent(offer.regular_price, offer.offer_price);
                    return (
                      <motion.div
                        key={offer.id}
                        whileHover={{ y: -2 }}
                        transition={{ duration: 0.16 }}
                        className="bg-white rounded-2xl border border-[#E5391B]/25 p-4 flex items-center gap-4"
                      >
                        <FoodImage
                          src={offer.image}
                          alt={offer.title}
                          className="w-20 h-20 rounded-xl shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-extrabold text-[#E5391B]">
                            {offPct}% OFF · Combo Deal
                          </p>
                          <h3 className="text-base font-bold text-neutral-900 truncate">
                            {offer.title}
                          </h3>
                          <p className="text-xs text-neutral-500 line-clamp-1 mb-2">
                            {offer.description}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono tabular-nums">
                              <span className="text-xs text-neutral-400 line-through mr-1.5">
                                {formatRupees(offer.regular_price)}
                              </span>
                              <span className="text-base font-extrabold text-neutral-900">
                                {formatRupees(offer.offer_price)}
                              </span>
                            </div>

                            {justAddedKeys[`offer:${offer.id}`] ? (
                              <motion.span
                                initial={prefersReducedMotion ? false : { scale: 0.9, opacity: 0.7 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Added
                              </motion.span>
                            ) : qty === 0 ? (
                              <button
                                type="button"
                                onClick={() => updateCartQty('offer', offer.id, 1)}
                                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                              >
                                + Add
                              </button>
                            ) : (
                              <div className="inline-flex items-center bg-[#FEF2F0] rounded-xl p-0.5">
                                <button
                                  type="button"
                                  onClick={() => updateCartQty('offer', offer.id, -1)}
                                  className="w-8 h-8 flex items-center justify-center text-[#E5391B] cursor-pointer"
                                  aria-label={`Remove ${offer.title}`}
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span className="w-6 text-center font-mono text-xs font-bold tabular-nums">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateCartQty('offer', offer.id, 1)}
                                  className="w-8 h-8 flex items-center justify-center text-[#E5391B] cursor-pointer"
                                  aria-label={`Add more ${offer.title}`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Search + Category Filter Bar */}
            <section id="rikzen-menu-grid" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search rolls, burgers, fries, lassi..."
                    aria-label="Search menu items"
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-white border border-neutral-200 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-[#E5391B] focus:ring-2 focus:ring-[#E5391B]/15 transition-all"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setVegOnly((v) => !v)}
                  aria-pressed={vegOnly}
                  className={`min-h-[44px] px-4 py-2 rounded-xl border text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                    vegOnly
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-xs border flex items-center justify-center ${
                      vegOnly ? 'border-white' : 'border-emerald-600'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        vegOnly ? 'bg-white' : 'bg-emerald-600'
                      }`}
                    />
                  </span>
                  Pure Veg Only
                </button>
              </div>

              <div
                className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1"
                role="tablist"
                aria-label="Food categories"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === 'all'}
                  onClick={() => setSelectedCategory('all')}
                  className={`min-h-[40px] px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-[#E5391B] text-white'
                      : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  All Items
                </button>
                {MENU_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`min-h-[40px] px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCategory === cat.id
                        ? 'bg-[#E5391B] text-white'
                        : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Menu Grid */}
              {filteredMenu.length === 0 ? (
                <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center">
                  <p className="text-base font-semibold text-neutral-900 mb-1">
                    No matching dishes found
                  </p>
                  <p className="text-sm text-neutral-500 mb-4">
                    Try clearing your search or switching food categories.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all');
                      setVegOnly(false);
                      setSearchQuery('');
                    }}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 cursor-pointer"
                  >
                    Show All Items
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredMenu.map((item) => {
                    const qty = cart[`menu:${item.id}`] || 0;
                    const isSoldOut = !item.available;
                    const effectivePrice = getEffectivePrice(item);
                    const offPct = getDiscountPercent(item.price, item.offer_price);

                    return (
                      <article
                        key={item.id}
                        className={`bg-white rounded-2xl border border-neutral-200 overflow-hidden flex flex-col transition-transform duration-150 hover:-translate-y-0.5 ${
                          isSoldOut ? 'opacity-65' : ''
                        }`}
                      >
                        <div className="aspect-[4/3] w-full bg-neutral-100">
                          <FoodImage src={item.image} alt={item.name} className="w-full h-full" />
                        </div>

                        <div className="p-5 flex-1 flex flex-col">
                          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1.5">
                            <span
                              title={item.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}
                              className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center shrink-0 ${
                                item.is_veg ? 'border-emerald-600' : 'border-red-600'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  item.is_veg ? 'bg-emerald-600' : 'bg-red-600'
                                }`}
                              />
                            </span>
                            <span>{CATEGORY_LABEL_MAP[item.category]}</span>
                            {offPct > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-extrabold">
                                  {offPct}% OFF
                                </span>
                              </>
                            )}
                            {isSoldOut && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-red-700 font-semibold">Sold Out</span>
                              </>
                            )}
                          </div>

                          <h3 className="text-lg font-bold text-neutral-900 leading-snug mb-1">
                            {item.name}
                          </h3>
                          <p className="text-sm text-neutral-600 line-clamp-2 mb-5 flex-1 leading-relaxed">
                            {item.description}
                          </p>

                          <div className="flex items-center justify-between gap-3 pt-3 border-t border-neutral-100">
                            <div className="flex items-baseline gap-2 font-mono tabular-nums">
                              {offPct > 0 && (
                                <span className="text-sm text-neutral-400 line-through">
                                  {formatRupees(item.price)}
                                </span>
                              )}
                              <span className="text-lg font-extrabold text-neutral-900">
                                {formatRupees(effectivePrice)}
                              </span>
                            </div>

                            {isSoldOut ? (
                              <span className="text-xs font-semibold text-neutral-500 px-3 py-2">
                                Unavailable
                              </span>
                            ) : justAddedKeys[`menu:${item.id}`] ? (
                              <motion.span
                                initial={prefersReducedMotion ? false : { scale: 0.9, opacity: 0.7 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <Check className="w-4 h-4" />
                                Added
                              </motion.span>
                            ) : qty === 0 ? (
                              <button
                                type="button"
                                onClick={() => updateCartQty('menu', item.id, 1)}
                                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#E5391B] text-white text-sm font-semibold hover:bg-[#C82E14] active:scale-[0.97] transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                              >
                                <Plus className="w-4 h-4" />
                                Add
                              </button>
                            ) : (
                              <div className="inline-flex items-center bg-[#FEF2F0] border border-[#E5391B]/25 rounded-xl p-0.5">
                                <button
                                  type="button"
                                  onClick={() => updateCartQty('menu', item.id, -1)}
                                  aria-label={`Remove one ${item.name}`}
                                  className="w-10 h-10 flex items-center justify-center rounded-lg text-[#E5391B] hover:bg-[#E5391B]/10 active:scale-95 transition-all cursor-pointer"
                                >
                                  <Minus className="w-4 h-4" />
                                </button>
                                <span className="w-8 text-center font-mono text-sm font-bold text-neutral-900 tabular-nums">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateCartQty('menu', item.id, 1)}
                                  aria-label={`Add one more ${item.name}`}
                                  className="w-10 h-10 flex items-center justify-center rounded-lg text-[#E5391B] hover:bg-[#E5391B]/10 active:scale-95 transition-all cursor-pointer"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: CART → CUSTOMER DETAILS (+91) → ORDER REVIEW          */}
        {/* ============================================================ */}
        {activeTab === 'cart' && (
          <div className="max-w-2xl mx-auto">
            {cartList.length === 0 ? (
              <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-neutral-100 text-neutral-500 flex items-center justify-center mx-auto mb-4">
                  <ShoppingBag className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-neutral-900 mb-2">Your cart is empty</h2>
                <p className="text-sm text-neutral-600 mb-6">
                  Add rolls, burgers, crispy snacks, or special combos for Table {tableNumber}.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="min-h-[48px] px-6 py-3 rounded-xl bg-[#E5391B] text-white font-semibold text-sm hover:bg-[#C82E14] transition-colors cursor-pointer"
                >
                  Browse Menu
                </button>
              </div>
            ) : checkoutStage === 'cart' ? (
              /* STEP 1: CART */
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-6">
                <div className="flex items-center justify-between gap-4 border-b border-neutral-100 pb-4">
                  <div>
                    <h2 className="text-2xl font-extrabold text-neutral-900">Your Cart</h2>
                    <p className="text-sm text-neutral-500">
                      Table {tableNumber} · {cartItemCount}{' '}
                      {cartItemCount === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('menu')}
                    className="text-sm font-semibold text-[#E5391B] hover:underline cursor-pointer whitespace-nowrap"
                  >
                    + Add more
                  </button>
                </div>

                <div className="divide-y divide-neutral-100">
                  {cartList.map((entry) => (
                    <div
                      key={`${entry.kind}:${entry.id}`}
                      className="py-4 flex items-center gap-4"
                    >
                      <FoodImage
                        src={entry.image}
                        alt={entry.name}
                        className="w-16 h-16 rounded-xl shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-neutral-900 truncate">
                          {entry.name}
                        </h3>
                        <p className="text-sm text-neutral-500 font-mono tabular-nums">
                          {entry.regularPrice > entry.effectivePrice && (
                            <span className="line-through text-neutral-400 mr-1.5">
                              {formatRupees(entry.regularPrice)}
                            </span>
                          )}
                          {formatRupees(entry.effectivePrice)} each
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="inline-flex items-center bg-neutral-100 rounded-xl p-0.5">
                          <button
                            type="button"
                            onClick={() => updateCartQty(entry.kind, entry.id, -1)}
                            aria-label={`Decrease ${entry.name}`}
                            className="w-9 h-9 flex items-center justify-center rounded-lg text-neutral-800 hover:bg-white cursor-pointer"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-7 text-center font-mono text-sm font-bold tabular-nums">
                            {entry.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(entry.kind, entry.id, 1)}
                            aria-label={`Increase ${entry.name}`}
                            className="w-9 h-9 flex items-center justify-center rounded-lg text-neutral-800 hover:bg-white cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <span className="font-mono text-sm font-bold text-neutral-900 tabular-nums">
                          {formatRupees(entry.effectivePrice * entry.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-neutral-200 space-y-2 tabular-nums">
                  <div className="flex items-center justify-between text-sm text-neutral-600">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatRupees(cartSubtotal)}</span>
                  </div>
                  {cartDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm font-semibold text-emerald-700">
                      <span>Offer Savings</span>
                      <span className="font-mono">-{formatRupees(cartDiscount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-lg font-extrabold text-neutral-900 pt-1">
                    <span>Total Amount</span>
                    <span className="font-mono">{formatRupees(cartTotal)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDetailsError(null);
                    setCheckoutStage('details');
                  }}
                  className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-[#E5391B] text-white font-bold text-base hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            ) : checkoutStage === 'details' ? (
              /* STEP 2: CUSTOMER DETAILS (NAME + MANDATORY +91 INDIAN MOBILE) */
              <form
                onSubmit={handleContinueFromDetails}
                className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-6"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCheckoutStage('cart')}
                    aria-label="Back to cart"
                    className="w-11 h-11 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-2xl font-extrabold text-neutral-900">Your Details</h2>
                    <p className="text-sm text-neutral-500">
                      Used to generate your personal RikZen bill for Table {tableNumber}.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="cust-name"
                      className="block text-xs font-bold text-neutral-700 mb-1.5"
                    >
                      Name *
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="cust-name"
                        type="text"
                        required
                        maxLength={80}
                        value={customerDetails.name}
                        onChange={(e) =>
                          setCustomerDetails((prev) => ({ ...prev, name: e.target.value }))
                        }
                        placeholder="Enter your name"
                        className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-[#E5391B]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="cust-mobile"
                      className="block text-xs font-bold text-neutral-700 mb-1.5"
                    >
                      Mobile Number * (India)
                    </label>
                    <div className="flex items-stretch rounded-xl border border-neutral-200 bg-neutral-50 focus-within:bg-white focus-within:border-[#E5391B] overflow-hidden">
                      <span className="px-3.5 flex items-center gap-1.5 bg-neutral-100 border-r border-neutral-200 font-mono text-sm font-bold text-neutral-800 select-none">
                        <Phone className="w-3.5 h-3.5 text-[#E5391B]" />
                        +91
                      </span>
                      <input
                        id="cust-mobile"
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        required
                        value={customerDetails.mobileDigits}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setCustomerDetails((prev) => ({ ...prev, mobileDigits: digits }));
                          if (detailsError) setDetailsError(null);
                        }}
                        placeholder="Enter 10-digit mobile number"
                        className="flex-1 min-h-[48px] px-3.5 py-2.5 bg-transparent font-mono text-sm text-neutral-900 placeholder:font-sans placeholder:text-neutral-400 focus:outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1.5">
                      Your bill PDF will be issued to this number and kept private with RikZen Fast
                      Food.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="cust-notes"
                      className="block text-xs font-bold text-neutral-700 mb-1.5"
                    >
                      Special Request (Optional)
                    </label>
                    <input
                      id="cust-notes"
                      type="text"
                      maxLength={200}
                      value={customerDetails.notes}
                      onChange={(e) =>
                        setCustomerDetails((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="Any special request? (e.g., Less spicy, extra mint chutney)"
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-[#E5391B]"
                    />
                  </div>
                </div>

                {detailsError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm font-semibold text-red-700"
                  >
                    {detailsError}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-[#E5391B] text-white font-bold text-base hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  Continue to Order
                  <ArrowRight className="w-5 h-5" />
                </button>
              </form>
            ) : (
              /* STEP 3: ORDER REVIEW */
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-6">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCheckoutStage('details')}
                    aria-label="Back to customer details"
                    className="w-11 h-11 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-2xl font-extrabold text-neutral-900">Your Order</h2>
                    <p className="text-sm font-semibold text-[#E5391B]">
                      Table {tableNumber} · {customerDetails.name}
                    </p>
                  </div>
                </div>

                <div className="bg-neutral-50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm border border-neutral-200/70">
                  <div>
                    <p className="text-neutral-500 text-xs">Bill Name &amp; Mobile</p>
                    <p className="font-bold text-neutral-900">
                      {customerDetails.name} ·{' '}
                      <span className="font-mono">
                        {formatIndianMobileDisplay(`+91${customerDetails.mobileDigits}`)}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckoutStage('details')}
                    className="text-xs font-bold text-[#E5391B] hover:underline cursor-pointer"
                  >
                    Edit Details
                  </button>
                </div>

                <div className="bg-neutral-50 rounded-2xl p-5 space-y-3 tabular-nums">
                  {cartList.map((entry) => (
                    <div
                      key={`${entry.kind}:${entry.id}`}
                      className="flex items-center justify-between text-sm sm:text-base"
                    >
                      <span className="font-medium text-neutral-800">
                        {entry.name} × {entry.quantity}
                      </span>
                      <span className="font-mono font-semibold text-neutral-900">
                        {formatRupees(entry.effectivePrice * entry.quantity)}
                      </span>
                    </div>
                  ))}
                  {customerDetails.notes.trim() && (
                    <p className="text-xs text-neutral-500 pt-2 border-t border-neutral-200">
                      Note: {customerDetails.notes.trim()}
                    </p>
                  )}
                  <div className="pt-3 border-t border-neutral-200 space-y-1.5">
                    <div className="flex items-center justify-between text-sm text-neutral-600">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatRupees(cartSubtotal)}</span>
                    </div>
                    {cartDiscount > 0 && (
                      <div className="flex items-center justify-between text-sm font-semibold text-emerald-700">
                        <span>Discount</span>
                        <span className="font-mono">-{formatRupees(cartDiscount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-lg font-extrabold text-neutral-900 pt-1">
                      <span>Total</span>
                      <span className="font-mono">{formatRupees(cartTotal)}</span>
                    </div>
                  </div>
                </div>

                {submitError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm font-semibold text-red-800"
                  >
                    {submitError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setCheckoutStage('cart')}
                    className="sm:w-1/3 min-h-[52px] px-5 py-3 rounded-xl border border-neutral-200 text-neutral-800 font-semibold text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-60"
                  >
                    Edit Cart
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleConfirmOrder}
                    className="sm:flex-1 min-h-[52px] px-6 py-3.5 rounded-xl bg-emerald-700 text-white font-bold text-base hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    {isSubmitting ? 'Placing Order...' : 'Place Order'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: LIVE ORDER TRACKER + CUSTOMER PDF BILL                */}
        {/* ============================================================ */}
        {activeTab === 'order' && (
          <div className="max-w-2xl mx-auto space-y-5">
            {!activeOrder ? (
              <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-neutral-100 text-neutral-500 flex items-center justify-center mx-auto mb-4">
                  <Receipt className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-neutral-900 mb-2">No active order yet</h2>
                <p className="text-sm text-neutral-600 mb-6">
                  Once you confirm an order for Table {tableNumber}, its live status and PDF bill
                  will appear here automatically.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="min-h-[48px] px-6 py-3 rounded-xl bg-[#E5391B] text-white font-semibold text-sm hover:bg-[#C82E14] transition-colors cursor-pointer"
                >
                  Open Menu
                </button>
              </div>
            ) : activeOrder.status === 'completed' || showThankYouManual ? (
              <ThankYouScreen
                tableNumber={activeOrder.table_number}
                orderNumber={activeOrder.order_number}
                total={activeOrder.total}
                onStartNewOrder={handleStartNewOrder}
              />
            ) : (
              <>
                <motion.div
                  key={activeOrder.status}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-6"
                >
                  {orderSyncError && (
                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between gap-3">
                      <span>{orderSyncError}</span>
                      <button
                        type="button"
                        onClick={handleDirectDownloadPdf}
                        className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {activeOrder.status === 'pending' && (
                    <div className="text-center space-y-3 py-1">
                      <div className="inline-flex items-center justify-center gap-2.5 sm:gap-3 px-4 py-3 rounded-2xl bg-amber-50/90 border border-amber-200/80 mx-auto">
                        <motion.div
                          animate={prefersReducedMotion ? undefined : { y: [0, -3, 0] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                          className="w-10 h-10 rounded-xl bg-white shadow-xs border border-amber-100 flex items-center justify-center"
                        >
                          <FoodArtIcon kind="burger" className="w-7 h-7" />
                        </motion.div>
                        <ArrowRight className="w-4 h-4 text-amber-500" />
                        <motion.div
                          animate={prefersReducedMotion ? undefined : { scale: [1, 1.07, 1] }}
                          transition={{ duration: 1.8, delay: 0.35, repeat: Infinity, ease: 'easeInOut' }}
                          className="w-10 h-10 rounded-xl bg-white shadow-xs border border-amber-100 text-amber-700 flex items-center justify-center"
                        >
                          <Clock className="w-5 h-5" />
                        </motion.div>
                      </div>
                      <p className="text-xs font-extrabold uppercase tracking-wider text-amber-700">
                        Pending Restaurant Confirmation
                      </p>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                        ORDER RECEIVED
                      </h2>
                      <p className="text-sm sm:text-base text-neutral-600">
                        Waiting for restaurant confirmation... Your bill &amp; payment QR will
                        appear here immediately once the kitchen confirms.
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'accepted' && (
                    <div className="text-center space-y-2 py-1">
                      <motion.div
                        initial={prefersReducedMotion ? false : { scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 20 }}
                        className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto mb-3 shadow-xs"
                      >
                        <CheckCircle2 className="w-9 h-9" />
                      </motion.div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-emerald-800">
                        ORDER CONFIRMED
                      </h2>
                      <p className="text-sm sm:text-base text-neutral-600">
                        Table {activeOrder.table_number} · Order{' '}
                        <span className="font-mono font-bold text-neutral-900">
                          #{activeOrderCode}
                        </span>{' '}
                        · Total{' '}
                        <span className="font-mono font-bold text-[#E5391B]">
                          {formatRupees(activeOrder.total)}
                        </span>
                      </p>
                      <p className="text-xs font-medium text-neutral-500">
                        Your bill is ready below — view, download, share, or pay anytime.
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'preparing' && (
                    <div className="text-center space-y-2 py-1">
                      <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-3">
                        <ChefHat className="w-7 h-7" />
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                        Preparing Your Food
                      </h2>
                      <p className="text-sm sm:text-base text-neutral-600">
                        Freshly cooking in the RikZen kitchen for Table {activeOrder.table_number}.
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'ready' && (
                    <div className="text-center space-y-2 py-1">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-3">
                        <Utensils className="w-7 h-7" />
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-emerald-800">
                        Order Ready
                      </h2>
                      <p className="text-sm sm:text-base text-neutral-600">
                        Your food is freshly plated and coming to Table {activeOrder.table_number}.
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'bill_requested' && (
                    <div className="text-center space-y-2 py-1">
                      <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-3">
                        <Receipt className="w-7 h-7" />
                      </div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                        Bill Requested
                      </h2>
                      <p className="text-sm sm:text-base text-neutral-600">
                        The RikZen counter has received your bill request.
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'bill_ready' && (
                    <div className="text-center space-y-2 py-1">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-3">
                        <Receipt className="w-7 h-7" />
                      </div>
                      <p className="text-xs font-bold tracking-wide text-emerald-700">
                        RikZen Fast Food
                      </p>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                        Bill Ready
                      </h2>
                      <p className="font-mono text-4xl font-extrabold text-neutral-900 tabular-nums pt-1">
                        {formatRupees(activeOrder.total)}
                      </p>
                    </div>
                  )}

                  {activeOrder.status === 'rejected' && (
                    <div className="text-center space-y-2 py-1">
                      <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center mx-auto mb-3">
                        <XCircle className="w-7 h-7" />
                      </div>
                      <h2 className="text-2xl font-extrabold text-red-700">Order Declined</h2>
                      <p className="text-sm text-neutral-600">
                        Sorry, the kitchen could not accept this order right now.
                      </p>
                    </div>
                  )}

                  {/* Metadata Strip */}
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-medium text-neutral-600 py-3 border-y border-neutral-100 tabular-nums">
                    <span className="font-bold text-neutral-900">{activeOrder.customer_name}</span>
                    <span aria-hidden="true">·</span>
                    <span>Table {activeOrder.table_number}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[#E5391B]">
                      #{activeOrderCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(activeOrder.created_at, nowMs)}</span>
                  </div>

                  {/* Confirmed Customer Bill & Honest 2-Mode Payment QR Card (Only after Owner Confirms!) */}
                  {activeOrder.status !== 'pending' && activeOrder.status !== 'rejected' && (() => {
                    const snap = activeOrder.payment_qr_snapshot;
                    const activeMode = snap?.mode || paymentSettings.payment_mode || 'dynamic_upi';
                    const activeMerchant = snap?.merchant_name || paymentSettings.merchant_name || 'RikZen Fast Food';
                    const activeQrImg = snap?.qr_image_url || paymentSettings.qr_image_url || '';
                    const activeUpiId = snap?.upi_id || paymentSettings.upi_id || '';
                    const dynamicUpiUri =
                      activeMode === 'dynamic_upi'
                        ? snap?.upi_uri ||
                          buildDynamicUpiUri({
                            upiId: activeUpiId,
                            merchantName: activeMerchant,
                            amount: activeOrder.total,
                            orderCode: activeOrderCode,
                            tableNumber: activeOrder.table_number,
                          }) ||
                          activeOrder.upi_uri ||
                          ''
                        : '';
                    const showUploadedQr = activeMode === 'uploaded_qr' && Boolean(activeQrImg);
                    const showDynamicUpi = activeMode === 'dynamic_upi' && Boolean(dynamicUpiUri);
                    const isPaid = activeOrder.payment_status === 'paid';
                    const isFailedPay = activeOrder.payment_status === 'failed';

                    return (
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 space-y-4">
                        {shareFeedback && (
                          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs font-bold text-emerald-800 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            {shareFeedback}
                          </div>
                        )}

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 rounded-xl bg-white border border-neutral-200 text-[#E5391B] flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-bold text-neutral-500">Your Bill</p>
                                {isPaid ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Payment Received
                                  </span>
                                ) : isFailedPay ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-red-700">
                                    <XCircle className="w-3.5 h-3.5" />
                                    Payment Failed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-800">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                    Payment Pending
                                  </span>
                                )}
                              </div>
                              <p className="text-base font-extrabold text-neutral-900 tabular-nums mt-0.5">
                                Order #{activeOrderCode} ·{' '}
                                <span className="font-mono text-[#E5391B]">
                                  {formatRupees(activeOrder.total)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 shrink-0">
                            {activeOrder.public_bill_id ? (
                              <button
                                type="button"
                                onClick={() => onNavigate(`/bill/${activeOrder.public_bill_id}`)}
                                className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-[#E5391B] text-white font-bold text-xs hover:bg-[#C82E14] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                              >
                                <ExternalLink className="w-4 h-4" />
                                View Bill
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setShowBillModal(true)}
                                className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-[#E5391B] text-white font-bold text-xs hover:bg-[#C82E14] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-4 h-4" />
                                View Bill
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={downloadingPdf}
                              onClick={handleDirectDownloadPdf}
                              className="flex-1 sm:flex-none min-h-[44px] px-3.5 py-2 rounded-xl bg-neutral-900 text-white font-bold text-xs hover:bg-neutral-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                            >
                              <Download className="w-4 h-4" />
                              {downloadingPdf ? 'Downloading...' : 'Download Bill'}
                            </button>
                            <button
                              type="button"
                              onClick={handleShareCustomerBill}
                              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white border border-neutral-200 text-neutral-900 font-bold text-xs hover:bg-neutral-100 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <Share2 className="w-4 h-4" />
                              Share Bill
                            </button>
                          </div>
                        </div>

                        {/* Honest 2-Mode Payment QR Box (Zero Cropping, Distortion, or Animation over QR) */}
                        {(showUploadedQr || showDynamicUpi) && !isPaid && (
                          <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-5">
                            {showUploadedQr ? (
                              <div className="bg-white p-2 rounded-xl border border-neutral-200 shrink-0">
                                <img
                                  src={activeQrImg}
                                  alt={`Payment QR for ${activeMerchant}`}
                                  className="w-44 h-44 object-contain"
                                />
                              </div>
                            ) : (
                              <div className="bg-white p-2 rounded-xl border border-neutral-200 shrink-0">
                                <QRCodeSVG
                                  value={dynamicUpiUri}
                                  size={184}
                                  level="H"
                                  includeMargin={true}
                                  fgColor="#000000"
                                  bgColor="#FFFFFF"
                                />
                              </div>
                            )}

                            <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151110] text-white text-[11px] font-extrabold tracking-wide">
                                <QrCode className="w-3.5 h-3.5 text-amber-300" />
                                SCAN TO PAY
                              </div>
                              <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] tabular-nums">
                                {formatRupees(activeOrder.total)}
                              </p>
                              <p className="text-xs font-bold text-neutral-900">{activeMerchant}</p>
                              {showDynamicUpi ? (
                                <>
                                  <p className="text-xs font-bold text-emerald-700">
                                    Scan to pay this exact amount · No need to type amount
                                  </p>
                                  {activeUpiId && (
                                    <p className="text-xs font-mono text-neutral-600 truncate">
                                      UPI ID:{' '}
                                      <span className="font-bold text-neutral-900">
                                        {activeUpiId}
                                      </span>
                                    </p>
                                  )}
                                  <div className="pt-1">
                                    <a
                                      href={dynamicUpiUri}
                                      className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center justify-center gap-1.5"
                                    >
                                      <Smartphone className="w-4 h-4" />
                                      Pay Now · {formatRupees(activeOrder.total)}
                                    </a>
                                  </div>
                                </>
                              ) : (
                                <p className="text-xs font-medium text-neutral-700">
                                  Scan this QR using any UPI app and pay{' '}
                                  <span className="font-bold text-neutral-900">
                                    {formatRupees(activeOrder.total)}
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
                      </div>
                    );
                  })()}

                  {/* Order Items Summary */}
                  <div className="bg-neutral-50 rounded-2xl p-5 space-y-2.5 tabular-nums">
                    <h3 className="text-xs font-semibold text-neutral-500">Order Items</h3>
                    {activeOrder.items.map((line) => (
                      <div
                        key={line.menu_item_id}
                        className="flex items-center justify-between text-sm text-neutral-800"
                      >
                        <span>
                          {line.name} × {line.quantity}
                        </span>
                        <span className="font-mono font-semibold">
                          {formatRupees(line.line_total)}
                        </span>
                      </div>
                    ))}
                    {activeOrder.discount > 0 && (
                      <div className="flex items-center justify-between text-sm font-semibold text-emerald-700 pt-2 border-t border-neutral-200">
                        <span>Offer Discount</span>
                        <span className="font-mono">-{formatRupees(activeOrder.discount)}</span>
                      </div>
                    )}
                    <div className="pt-2.5 border-t border-neutral-200 flex items-center justify-between text-base font-extrabold text-neutral-900">
                      <span>Total</span>
                      <span className="font-mono">{formatRupees(activeOrder.total)}</span>
                    </div>
                  </div>

                  {/* Primary Action */}
                  {['accepted', 'preparing', 'ready'].includes(activeOrder.status) && (
                    <button
                      type="button"
                      disabled={isRequestingBill}
                      onClick={handleRequestBill}
                      className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-neutral-900 text-white font-bold text-base hover:bg-neutral-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      <Receipt className="w-5 h-5" />
                      {isRequestingBill ? 'Sending Bill Request...' : 'Request Bill'}
                    </button>
                  )}

                  {activeOrder.status === 'bill_ready' && (
                    <button
                      type="button"
                      onClick={() => setShowThankYouManual(true)}
                      className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-emerald-700 text-white font-bold text-base hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Check className="w-5 h-5" />
                      Finish &amp; Complete Visit
                    </button>
                  )}

                  {activeOrder.status === 'rejected' && (
                    <button
                      type="button"
                      onClick={handleStartNewOrder}
                      className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-[#E5391B] text-white font-bold text-base hover:bg-[#C82E14] transition-colors cursor-pointer"
                    >
                      Place a New Order
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: SHOP INFO                                             */}
        {/* ============================================================ */}
        {activeTab === 'info' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-5">
              <div>
                <p className="text-xs font-semibold text-[#E5391B] mb-1">About Us</p>
                <h2 className="text-2xl font-extrabold text-neutral-900">RikZen Fast Food</h2>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Freshly grilled rolls, crispy burgers, loaded fries, sizzling noodles, and thick
                  hand-churned lassi — prepared hot to order and served directly to your table.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-neutral-100 text-sm">
                <div>
                  <p className="text-xs font-semibold text-neutral-500">Current Seat</p>
                  <p className="font-bold text-neutral-900 mt-0.5">Table {tableNumber}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-500">Opening Hours</p>
                  <p className="font-bold text-neutral-900 mt-0.5">Daily · 11:00 AM – 11:00 PM</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-500">Billing</p>
                  <p className="font-bold text-neutral-900 mt-0.5">
                    Instant Website Bill, PDF Download &amp; UPI QR
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-neutral-500">Privacy</p>
                  <p className="font-bold text-neutral-900 mt-0.5">
                    Mobile numbers stay strictly private
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-100 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/')}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                >
                  All Table QR Codes
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/owner')}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 inline-flex items-center gap-2 cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  Owner Dashboard
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Cart Bar */}
      <AnimatePresence>
        {activeTab === 'menu' && cartItemCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-16 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-auto z-30 pointer-events-none"
          >
            <button
              type="button"
              onClick={() => {
                setCheckoutStage('cart');
                setActiveTab('cart');
              }}
              className="pointer-events-auto w-full md:w-auto min-h-[48px] px-5 py-3 rounded-2xl bg-[#E5391B] text-white shadow-lg shadow-[#E5391B]/25 hover:bg-[#C82E14] active:scale-[0.98] transition-all flex items-center justify-between md:justify-center gap-6 cursor-pointer"
            >
              <span className="font-semibold text-sm tabular-nums">
                {cartItemCount} {cartItemCount === 1 ? 'Item' : 'Items'} ·{' '}
                {formatRupees(cartTotal)}
              </span>
              <span className="font-bold text-sm inline-flex items-center gap-1 whitespace-nowrap">
                View Cart
                <ArrowRight className="w-4 h-4" />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Customer navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-neutral-200 grid grid-cols-4"
      >
        <button
          type="button"
          onClick={() => setActiveTab('menu')}
          className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'menu' ? 'text-[#E5391B]' : 'text-neutral-500'
          }`}
        >
          <Utensils className="w-5 h-5" />
          <span className="text-[11px] font-semibold">Menu</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCheckoutStage('cart');
            setActiveTab('cart');
          }}
          className={`relative flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'cart' ? 'text-[#E5391B]' : 'text-neutral-500'
          }`}
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5" />
            {cartItemCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E5391B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {cartItemCount}
              </span>
            )}
          </div>
          <span className="text-[11px] font-semibold">Cart</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('order')}
          className={`relative flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'order' ? 'text-[#E5391B]' : 'text-neutral-500'
          }`}
        >
          <div className="relative">
            <Receipt className="w-5 h-5" />
            {hasLiveOrderBadge && (
              <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-emerald-600" />
            )}
          </div>
          <span className="text-[11px] font-semibold">My Order</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('info')}
          className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === 'info' ? 'text-[#E5391B]' : 'text-neutral-500'
          }`}
        >
          <Info className="w-5 h-5" />
          <span className="text-[11px] font-semibold">Info</span>
        </button>
      </nav>

      {/* Customer Bill Preview Modal */}
      {showBillModal && activeOrder && (
        <BillPreviewModal
          order={activeOrder}
          onClose={() => setShowBillModal(false)}
          isOwnerView={false}
          paymentSettings={paymentSettings}
        />
      )}
    </div>
  );
};
