import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Gift,
  Home,
  LayoutGrid,
  Lock,
  LogOut,
  Phone,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Tag,
  Trash2,
  TrendingUp,
  Utensils,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react';
import {
  CANONICAL_MENU_ITEMS,
  CANONICAL_OFFERS,
  MENU_CATEGORIES,
  TABLE_NUMBERS,
} from '../data/menuCatalog';
import { auth, BOOTSTRAPPED_OWNER_EMAIL, googleProvider } from '../lib/firebase';
import {
  checkIsOwnerAccount,
  downloadOrderBillPdf,
  downloadSalesReportPdf,
  fetchOwnerConfigStatus,
  formatIndianMobileDisplay,
  formatRelativeTime,
  formatRupees,
  getTableQrUrl,
  ownerDeleteMenuItem,
  ownerDeleteOffer,
  ownerSendWhatsAppBill,
  ownerToggleMenuItemAvailability,
  ownerToggleOfferActive,
  ownerUpdateOrderStatus,
  playKitchenAlertChime,
  seedOwnerShopDataIfNeeded,
  subscribeToAllOrders,
  subscribeToMenuItems,
  subscribeToOffers,
  subscribeToTables,
  syncCatalogToServer,
  timestampToDate,
} from '../lib/orderService';
import {
  buildHourlySalesSeries,
  getDailyReportFilename,
  isRevenueOrder,
} from '../lib/salesAnalytics';
import {
  getDiscountPercent,
  getEffectivePrice,
  MenuCategoryId,
  MenuItem,
  OfferRecord,
  OrderRecord,
  OrderStatus,
  TableRecord,
  TableStatus,
} from '../types/restaurant';
import { BillPreviewModal } from './BillPreviewModal';
import { FoodArtIcon } from './FoodArtIcons';
import { FoodImage } from './FoodImage';
import {
  AnimatedNumber,
  AnimatedSalesBarChart,
  OwnerAnalyticsSection,
} from './OwnerAnalyticsSection';
import { MenuItemModal, OfferModal } from './OwnerModals';

interface OwnerDashboardProps {
  onNavigate: (path: string) => void;
}

type OwnerSection =
  | 'dashboard'
  | 'menu'
  | 'offers'
  | 'tables'
  | 'bills'
  | 'reports'
  | 'settings';
type OrderFilter = 'all_active' | 'pending' | 'preparing' | 'ready' | 'bill_requested' | 'completed';

const CATEGORY_LABELS: Record<MenuCategoryId, string> = Object.fromEntries(
  MENU_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<MenuCategoryId, string>;

const TABLE_STATUS_META: Record<TableStatus, { label: string; colorClass: string; dotClass: string }> = {
  available: { label: 'Available', colorClass: 'text-emerald-700', dotClass: 'bg-emerald-600' },
  ordering: { label: 'Ordering', colorClass: 'text-red-700', dotClass: 'bg-red-600' },
  preparing: { label: 'Preparing', colorClass: 'text-amber-700', dotClass: 'bg-amber-500' },
  ready: { label: 'Ready', colorClass: 'text-emerald-700', dotClass: 'bg-emerald-600' },
  bill_requested: { label: 'Bill Requested', colorClass: 'text-amber-800', dotClass: 'bg-amber-600' },
};

const NAV_ITEMS: Array<{ id: OwnerSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'menu', label: 'Menu', icon: Utensils },
  { id: 'offers', label: 'Offers', icon: Gift },
  { id: 'tables', label: 'Tables', icon: LayoutGrid },
  { id: 'bills', label: 'Bills', icon: Receipt },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({ onNavigate }) => {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Navigation & filter state
  const [section, setSection] = useState<OwnerSection>('dashboard');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all_active');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(CANONICAL_MENU_ITEMS);
  const [offers, setOffers] = useState<OfferRecord[]>(CANONICAL_OFFERS);
  const [whatsappConfigured, setWhatsappConfigured] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Action busy states
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [sendingWaOrderId, setSendingWaOrderId] = useState<string | null>(null);
  const [downloadingBillId, setDownloadingBillId] = useState<string | null>(null);
  const [billErrors, setBillErrors] = useState<Record<string, string>>({});
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [confirmDeleteOfferId, setConfirmDeleteOfferId] = useState<string | null>(null);

  // Modals & inspector state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [focusOfferOnEdit, setFocusOfferOnEdit] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<OfferRecord | null>(null);
  const [previewBillOrder, setPreviewBillOrder] = useState<OrderRecord | null>(null);
  const [selectedTableNum, setSelectedTableNum] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [copiedTable, setCopiedTable] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [newOrderBanner, setNewOrderBanner] = useState<OrderRecord | null>(null);
  const [quickReportBusy, setQuickReportBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const prefersReducedMotion = useReducedMotion();

  const knownOrderStatusesRef = useRef<Map<string, OrderStatus>>(new Map());
  const seenNewOrderIdsRef = useRef<Set<string>>(new Set());
  const initialOrdersLoadedRef = useRef(false);
  const liveOrdersRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? null : curr)), 2800);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (nextUser) {
        const verified = await checkIsOwnerAccount(nextUser);
        setIsOwner(verified);
        if (verified) {
          try {
            await seedOwnerShopDataIfNeeded(nextUser);
            const cfg = await fetchOwnerConfigStatus();
            setWhatsappConfigured(cfg.whatsappConfigured);
          } catch (err) {
            setDataError(err instanceof Error ? err.message : 'Unable to initialize shop data.');
          }
        }
      } else {
        setIsOwner(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Real-time Firestore listeners (strictly after verified Owner auth)
  useEffect(() => {
    if (!authReady || !user || !isOwner) {
      initialOrdersLoadedRef.current = false;
      knownOrderStatusesRef.current.clear();
      return;
    }

    setDataError(null);

    const unsubOrders = subscribeToAllOrders(
      (incomingOrders) => {
        if (!initialOrdersLoadedRef.current) {
          for (const ord of incomingOrders) {
            seenNewOrderIdsRef.current.add(ord.id);
          }
        } else {
          for (const ord of incomingOrders) {
            const prevStatus = knownOrderStatusesRef.current.get(ord.id);
            if (!prevStatus && ord.status === 'pending' && !seenNewOrderIdsRef.current.has(ord.id)) {
              seenNewOrderIdsRef.current.add(ord.id);
              setNewOrderBanner(ord);
              window.setTimeout(() => {
                setNewOrderBanner((curr) => (curr?.id === ord.id ? null : curr));
              }, 8500);
              if (soundEnabled) {
                playKitchenAlertChime('order');
              }
              break;
            }
            if (prevStatus && prevStatus !== 'bill_requested' && ord.status === 'bill_requested') {
              if (soundEnabled) {
                playKitchenAlertChime('bill');
              }
              break;
            }
          }
        }
        const nextMap = new Map<string, OrderStatus>();
        for (const ord of incomingOrders) {
          nextMap.set(ord.id, ord.status);
        }
        knownOrderStatusesRef.current = nextMap;
        initialOrdersLoadedRef.current = true;
        setOrders(incomingOrders);
      },
      (err) => setDataError(err.message),
    );

    const unsubTables = subscribeToTables(
      (incomingTables) => setTables(incomingTables),
      (err) => setDataError(err.message),
    );

    const unsubMenu = subscribeToMenuItems((items) => setMenuItems(items));
    const unsubOffers = subscribeToOffers((list) => setOffers(list));

    return () => {
      unsubOrders();
      unsubTables();
      unsubMenu();
      unsubOffers();
    };
  }, [authReady, user, isOwner, soundEnabled]);

  // Keep server-side pricing engine synced whenever Owner updates menu items or offers
  useEffect(() => {
    if (!authReady || !user || !isOwner) return;
    syncCatalogToServer(menuItems, offers);
  }, [authReady, user, isOwner, menuItems, offers]);

  // Keep preview modal synced live with Firestore order updates
  const livePreviewOrder = useMemo(() => {
    if (!previewBillOrder) return null;
    return orders.find((o) => o.id === previewBillOrder.id) || previewBillOrder;
  }, [orders, previewBillOrder]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleSendWhatsApp = async (order: OrderRecord) => {
    if (sendingWaOrderId) return;
    setSendingWaOrderId(order.id);
    try {
      const result = await ownerSendWhatsAppBill(order);
      if (result.delivered) {
        showToast(`Bill #${order.order_code} sent to ${order.customer_name} on WhatsApp.`);
      } else {
        showToast(result.error || 'WhatsApp delivery failed.');
      }
    } finally {
      setSendingWaOrderId(null);
    }
  };

  const handleStatusChange = async (order: OrderRecord, nextStatus: OrderStatus) => {
    if (busyOrderId) return;
    setBusyOrderId(order.id);
    setDataError(null);
    try {
      await ownerUpdateOrderStatus(order, nextStatus);
      if (nextStatus === 'accepted') {
        showToast(`Order #${order.order_code} confirmed & PDF bill ready.`);
        // Automatically attempt WhatsApp delivery when WhatsApp Business API is configured
        if (whatsappConfigured) {
          void handleSendWhatsApp(order);
        }
      } else if (nextStatus === 'bill_ready') {
        showToast(`Bill ready for Table ${order.table_number}.`);
      } else if (nextStatus === 'completed') {
        showToast(`Table ${order.table_number} completed & available.`);
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Could not update order status.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleDownloadPdf = async (order: OrderRecord) => {
    if (downloadingBillId) return;
    setDownloadingBillId(order.id);
    setBillErrors((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
    try {
      const bill = await downloadOrderBillPdf(order);
      showToast(`Downloaded ${bill.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bill generation failed. Please try again.';
      console.error('[OwnerDashboard PDF Download Error]', err);
      setBillErrors((prev) => ({ ...prev, [order.id]: msg }));
      showToast(`Bill download failed: ${msg}`);
    } finally {
      setDownloadingBillId(null);
    }
  };

  const getBillStatusMeta = (order: OrderRecord) => {
    const status = order.bill_status || (order.pdf_ready ? 'generated' : 'not_generated');
    switch (status) {
      case 'generating':
        return { label: 'Generating bill...', color: 'text-amber-700', dot: 'bg-amber-500' };
      case 'sending':
        return { label: 'Sending...', color: 'text-blue-700', dot: 'bg-blue-600' };
      case 'retrying':
        return { label: 'Retrying...', color: 'text-blue-700', dot: 'bg-blue-600' };
      case 'sent':
        return { label: 'BILL SENT', color: 'text-emerald-700', dot: 'bg-emerald-600' };
      case 'failed':
        return { label: 'SEND FAILED', color: 'text-red-700', dot: 'bg-red-600' };
      case 'generated':
        return { label: 'PDF Ready', color: 'text-emerald-700', dot: 'bg-emerald-600' };
      default:
        return { label: 'Not Generated', color: 'text-neutral-500', dot: 'bg-neutral-400' };
    }
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    try {
      await ownerDeleteMenuItem(itemId);
      setConfirmDeleteItemId(null);
      showToast('Menu item deleted.');
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Unable to delete item.');
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    try {
      await ownerDeleteOffer(offerId);
      setConfirmDeleteOfferId(null);
      showToast('Offer deleted.');
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Unable to delete offer.');
    }
  };

  const handleCopyQrUrl = async (tableNum: number) => {
    try {
      await navigator.clipboard.writeText(getTableQrUrl(tableNum));
      setCopiedTable(tableNum);
      window.setTimeout(() => setCopiedTable(null), 1800);
    } catch {
      // Ignore clipboard errors
    }
  };

  // Live 6-Table derived status
  const liveTableSummaries = useMemo(() => {
    const activeByTable = new Map<number, OrderRecord>();
    for (const order of orders) {
      if (!['completed', 'rejected'].includes(order.status) && !activeByTable.has(order.table_number)) {
        activeByTable.set(order.table_number, order);
      }
    }

    return TABLE_NUMBERS.map((num) => {
      const activeOrder = activeByTable.get(num) || null;
      const stored = tables.find((t) => t.table_number === num);
      let status: TableStatus = 'available';
      if (activeOrder) {
        if (activeOrder.status === 'pending' || activeOrder.status === 'accepted') status = 'ordering';
        else if (activeOrder.status === 'preparing') status = 'preparing';
        else if (activeOrder.status === 'ready') status = 'ready';
        else if (activeOrder.status === 'bill_requested' || activeOrder.status === 'bill_ready')
          status = 'bill_requested';
      } else if (stored && stored.active_order_id === '') {
        status = 'available';
      }
      return { tableNumber: num, status, activeOrder };
    });
  }, [orders, tables]);

  // Order Stage Counts & Real Completed-Only Revenue KPIs
  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    const todaysNonRejected = orders.filter(
      (o) => timestampToDate(o.created_at).getTime() >= todayMs && o.status !== 'rejected',
    );
    // STRICT REVENUE RULE: Only completed/paid orders count toward sales revenue
    const todaysCompleted = todaysNonRejected.filter(isRevenueOrder);
    const todaysSales = todaysCompleted.reduce((sum, o) => sum + o.total, 0);
    const todaysDiscounts = todaysCompleted.reduce((sum, o) => sum + (o.discount || 0), 0);

    const newCount = orders.filter((o) => o.status === 'pending').length;
    const preparingCount = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing').length;
    const readyCount = orders.filter((o) => o.status === 'ready').length;
    const billReqCount = orders.filter((o) => o.status === 'bill_requested' || o.status === 'bill_ready').length;
    const completedCount = orders.filter((o) => o.status === 'completed').length;
    const activeTablesCount = liveTableSummaries.filter((t) => t.status !== 'available').length;

    return {
      todaysOrders: todaysNonRejected.length,
      todaysCompletedCount: todaysCompleted.length,
      todaysSales,
      todaysDiscounts,
      avgOrderValue: todaysCompleted.length > 0 ? Math.round(todaysSales / todaysCompleted.length) : 0,
      newCount,
      preparingCount,
      readyCount,
      billReqCount,
      completedCount,
      activeTablesCount,
    };
  }, [orders, liveTableSummaries]);

  const todaysHourlyOverview = useMemo(() => buildHourlySalesSeries(orders, new Date()), [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      switch (orderFilter) {
        case 'all_active':
          return !['completed', 'rejected'].includes(o.status);
        case 'pending':
          return o.status === 'pending';
        case 'preparing':
          return o.status === 'accepted' || o.status === 'preparing';
        case 'ready':
          return o.status === 'ready';
        case 'bill_requested':
          return o.status === 'bill_requested' || o.status === 'bill_ready';
        case 'completed':
          return o.status === 'completed' || o.status === 'rejected';
        default:
          return true;
      }
    });
  }, [orders, orderFilter]);

  const billOrders = useMemo(
    () => orders.filter((o) => o.status !== 'rejected'),
    [orders],
  );

  const handleQuickDailyReportDownload = async () => {
    if (quickReportBusy) return;
    setQuickReportBusy(true);
    try {
      const today = new Date();
      const saved = await downloadSalesReportPdf({
        reportType: 'daily',
        periodLabel: today.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        filename: getDailyReportFilename(today),
        orders: todaysHourlyOverview.completedOrders,
      });
      showToast(`Downloaded ${saved}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to download daily report.');
    } finally {
      setQuickReportBusy(false);
    }
  };

  const selectedTableData = useMemo(
    () => liveTableSummaries.find((t) => t.tableNumber === selectedTableNum) || null,
    [liveTableSummaries, selectedTableNum],
  );

  // =========================================================================
  // AUTH GATES
  // =========================================================================
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <p className="text-sm font-semibold text-neutral-500">Opening RikZen Owner POS...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl border border-neutral-200 p-8 sm:p-10 space-y-6">
          <div>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-900 mb-6 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to RikZen Fast Food
            </button>
            <div className="w-12 h-12 rounded-2xl bg-[#FEF2F0] text-[#E5391B] flex items-center justify-center mb-4">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold text-neutral-900">RikZen Owner POS</h1>
            <p className="text-sm text-neutral-600 mt-1.5 leading-relaxed">
              Sign in with your authorized RikZen Fast Food owner Google account to manage live
              orders, menu prices, offers, and customer PDF bills.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={isSigningIn}
            onClick={handleGoogleSignIn}
            className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
          >
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl border border-neutral-200 p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-neutral-900">Owner Access Only</h1>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Signed in as <span className="font-semibold text-neutral-900">{user.email}</span>.
            Customer data and admin controls are strictly restricted to{' '}
            <span className="font-mono text-xs">{BOOTSTRAPPED_OWNER_EMAIL}</span>.
          </p>
          <div className="flex flex-col gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 cursor-pointer"
            >
              Sign Out &amp; Switch Account
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="w-full min-h-[44px] px-5 py-2.5 rounded-xl border border-neutral-200 text-neutral-700 font-semibold text-sm hover:bg-neutral-50 cursor-pointer"
            >
              Back to QR Entrance
            </button>
          </div>
        </div>
      </div>
    );
  }

  const urgentCount = stats.newCount + stats.billReqCount;

  // =========================================================================
  // REDESIGNED MOBILE-APP-LIKE OWNER POS DASHBOARD
  // =========================================================================
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 bg-white border-r border-neutral-200 flex-col justify-between p-5 sticky top-0 h-screen">
        <div className="space-y-6">
          <div>
            <button
              type="button"
              onClick={() => setSection('dashboard')}
              className="font-display text-xl font-extrabold tracking-tight text-neutral-900 cursor-pointer text-left"
            >
              RikZen <span className="text-[#E5391B]">Fast Food</span>
            </button>
            <p className="text-xs text-neutral-500 mt-0.5">Owner POS &amp; Billing</p>
          </div>

          <nav className="space-y-1">
            {NAV_ITEMS.map((nav) => {
              const Icon = nav.icon;
              const active = section === nav.id;
              const badge =
                nav.id === 'dashboard' && urgentCount > 0
                  ? urgentCount
                  : nav.id === 'tables' && stats.activeTablesCount > 0
                    ? stats.activeTablesCount
                    : null;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => setSection(nav.id)}
                  className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#E5391B] text-white'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="w-4 h-4" />
                    {nav.label}
                  </span>
                  {badge !== null && (
                    <span
                      className={`font-mono text-xs font-bold tabular-nums ${
                        active ? 'text-white' : 'text-[#E5391B]'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-neutral-100">
          <div className="text-xs">
            <p className="font-bold text-neutral-900 truncate">
              {user.displayName || 'RikZen Owner'}
            </p>
            <p className="text-neutral-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main App Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Sticky Header */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-display text-lg font-extrabold tracking-tight text-neutral-900 whitespace-nowrap">
              RikZen <span className="text-[#E5391B]">Fast Food</span>
            </span>
            <h1 className="hidden lg:block text-xl font-extrabold text-neutral-900 truncate">
              {section === 'dashboard' && 'Live Orders'}
              {section === 'menu' && 'Menu Management'}
              {section === 'offers' && 'Offers'}
              {section === 'tables' && 'Tables & QR Codes'}
              {section === 'bills' && 'Customer Bills & WhatsApp'}
              {section === 'reports' && 'Sales Reports & History'}
              {section === 'settings' && 'Shop Settings'}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
              className="min-h-[40px] min-w-[40px] px-3 rounded-xl border border-neutral-200 text-neutral-700 hover:bg-neutral-50 inline-flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-emerald-700" />
              ) : (
                <VolumeX className="w-4 h-4 text-neutral-400" />
              )}
              <span className="hidden sm:inline">{soundEnabled ? 'Bell On' : 'Muted'}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/menu?table=3')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Table 3 Menu
            </button>
          </div>
        </header>

        {/* Mobile Scrollable Quick Section Strip (Covers all 7 sections effortlessly) */}
        <div className="lg:hidden bg-white border-b border-neutral-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((nav) => {
            const Icon = nav.icon;
            const active = section === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setSection(nav.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#E5391B] text-white'
                    : 'bg-neutral-100 text-neutral-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {nav.label}
              </button>
            );
          })}
        </div>

        {/* Live New Order Slide-In Banner (Animates Once Per New Order) */}
        <AnimatePresence>
          {newOrderBanner && (
            <motion.div
              key={newOrderBanner.id}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 48 }}
              transition={{ duration: 0.24 }}
              className="fixed top-20 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl bg-[#151110] text-white border border-[#E5391B]/50 shadow-2xl p-4 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-extrabold tracking-wider text-amber-300 uppercase">
                    NEW ORDER · Table {newOrderBanner.table_number}
                  </p>
                  <p className="text-base font-extrabold text-white mt-0.5 truncate">
                    {newOrderBanner.customer_name} ·{' '}
                    <span className="font-mono text-amber-300">
                      {formatRupees(newOrderBanner.total)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewOrderBanner(null)}
                  aria-label="Dismiss new order notification"
                  className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-neutral-300 line-clamp-2">
                {newOrderBanner.items.map((l) => `${l.name} ×${l.quantity}`).join(', ')}
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setSection('dashboard');
                    setOrderFilter('pending');
                    setNewOrderBanner(null);
                    liveOrdersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="flex-1 min-h-[36px] px-3 py-1.5 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] cursor-pointer"
                >
                  Open New Order
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline Toast Banner */}
        <AnimatePresence>
          {toastMsg && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-sm bg-neutral-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-lg"
            >
              {toastMsg}
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 p-4 sm:p-6 pb-24 lg:pb-10 max-w-6xl w-full mx-auto space-y-6">
          {dataError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
              {dataError}
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 1: LIVE POS DASHBOARD                              */}
          {/* ========================================================== */}
          {section === 'dashboard' && (
            <div className="space-y-6">
              {/* Top Animated Brand Hero Strip */}
              <div className="relative overflow-hidden rounded-3xl bg-[#151110] text-white px-5 sm:px-7 py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                {/* Subtle Floating Food Icons */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20" aria-hidden="true">
                  <motion.div
                    animate={prefersReducedMotion ? undefined : { y: [-4, 5, -4], rotate: [-4, 4, -4] }}
                    transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute right-8 top-3"
                  >
                    <FoodArtIcon kind="burger" className="w-10 h-10" />
                  </motion.div>
                  <motion.div
                    animate={prefersReducedMotion ? undefined : { y: [4, -5, 4], rotate: [4, -4, 4] }}
                    transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute right-24 bottom-2"
                  >
                    <FoodArtIcon kind="pizza" className="w-9 h-9" />
                  </motion.div>
                  <motion.div
                    animate={prefersReducedMotion ? undefined : { y: [-3, 4, -3] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="hidden sm:block absolute right-44 top-4"
                  >
                    <FoodArtIcon kind="fries" className="w-8 h-8" />
                  </motion.div>
                  <motion.div
                    animate={prefersReducedMotion ? undefined : { y: [3, -4, 3] }}
                    transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="hidden md:block absolute right-64 bottom-3"
                  >
                    <FoodArtIcon kind="roll" className="w-8 h-8" />
                  </motion.div>
                </div>

                <div className="relative z-10">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-amber-300">
                    LIVE DASHBOARD · POS CONTROL
                  </p>
                  <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight mt-0.5">
                    RIKZEN <span className="text-[#E5391B]">FAST FOOD</span>
                  </h2>
                  <p className="text-xs text-neutral-300 mt-1">
                    Real-time kitchen orders, verified completed sales, and instant customer PDF bills.
                  </p>
                </div>

                <div className="relative z-10 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSection('reports')}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <BarChart3 className="w-4 h-4 text-amber-300" />
                    Sales &amp; Reports
                  </button>
                  <button
                    type="button"
                    disabled={quickReportBusy}
                    onClick={handleQuickDailyReportDownload}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] hover:bg-[#C82E14] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    {quickReportBusy ? 'Generating...' : 'Daily Report PDF'}
                  </button>
                </div>
              </div>

              {/* 4 Animated Top KPI Cards (Real Completed Revenue ONLY) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5"
                >
                  <p className="text-xs font-bold text-neutral-500">Today&apos;s Sales</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] mt-1">
                    <AnimatedNumber value={stats.todaysSales} prefix="₹" />
                  </p>
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    From completed orders only
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5"
                >
                  <p className="text-xs font-bold text-neutral-500">Today&apos;s Orders</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-neutral-900 mt-1">
                    <AnimatedNumber value={stats.todaysOrders} />
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium mt-1 tabular-nums">
                    Avg completed: {formatRupees(stats.avgOrderValue)}
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => setSection('tables')}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 cursor-pointer hover:border-neutral-300"
                >
                  <p className="text-xs font-bold text-neutral-500">Active Tables</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-neutral-900 mt-1">
                    <AnimatedNumber value={stats.activeTablesCount} suffix=" / 6" />
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium mt-1">
                    {6 - stats.activeTablesCount} tables available
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5"
                >
                  <p className="text-xs font-bold text-neutral-500">Completed Orders</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-1">
                    <AnimatedNumber value={stats.todaysCompletedCount} />
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium mt-1 tabular-nums">
                    {stats.completedCount} total all-time
                  </p>
                </motion.div>
              </div>

              {/* Compact Sales Overview Chart Card */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-extrabold text-neutral-900 inline-flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-[#E5391B]" />
                      Today&apos;s Sales Overview
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Live hourly completed sales — updates automatically when orders complete.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('reports')}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                  >
                    Weekly &amp; Monthly Reports →
                  </button>
                </div>

                <AnimatedSalesBarChart
                  buckets={todaysHourlyOverview.buckets}
                  compact={true}
                  emptyMessage="Mark an order Completed to see real hourly revenue appear here."
                />
              </div>

              {/* 5 Large Simple POS Queue Filter Cards */}
              <div ref={liveOrdersRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                {[
                  {
                    id: 'pending' as const,
                    label: 'New Orders',
                    count: stats.newCount,
                    accent: 'text-red-700',
                    ring: 'border-red-300 bg-red-50/40',
                  },
                  {
                    id: 'preparing' as const,
                    label: 'Preparing',
                    count: stats.preparingCount,
                    accent: 'text-amber-700',
                    ring: 'border-amber-300 bg-amber-50/40',
                  },
                  {
                    id: 'ready' as const,
                    label: 'Ready',
                    count: stats.readyCount,
                    accent: 'text-emerald-700',
                    ring: 'border-emerald-300 bg-emerald-50/40',
                  },
                  {
                    id: 'bill_requested' as const,
                    label: 'Bill Requested',
                    count: stats.billReqCount,
                    accent: 'text-amber-800',
                    ring: 'border-amber-300 bg-amber-50/40',
                  },
                  {
                    id: 'completed' as const,
                    label: 'Completed',
                    count: stats.completedCount,
                    accent: 'text-neutral-800',
                    ring: 'border-neutral-300 bg-neutral-100/70',
                  },
                ].map((card) => {
                  const selected = orderFilter === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() =>
                        setOrderFilter((prev) => (prev === card.id ? 'all_active' : card.id))
                      }
                      className={`text-left rounded-2xl border p-4 sm:p-5 transition-all active:scale-[0.98] cursor-pointer ${
                        selected
                          ? `${card.ring} ring-2 ring-neutral-900/10`
                          : 'bg-white border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <p className={`text-xs font-bold ${card.accent}`}>{card.label}</p>
                      <p className="font-mono text-3xl font-extrabold text-neutral-900 mt-1 tabular-nums">
                        {card.count}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-neutral-900">
                  {orderFilter === 'all_active'
                    ? 'All Live Orders'
                    : orderFilter === 'pending'
                      ? 'New Orders'
                      : orderFilter === 'preparing'
                        ? 'Confirmed & Preparing'
                        : orderFilter === 'ready'
                          ? 'Ready to Serve'
                          : orderFilter === 'bill_requested'
                            ? 'Bill Requests & Ready Bills'
                            : 'Completed Orders'}
                </h2>
                {orderFilter !== 'all_active' && (
                  <button
                    type="button"
                    onClick={() => setOrderFilter('all_active')}
                    className="text-xs font-bold text-[#E5391B] hover:underline cursor-pointer"
                  >
                    Show All Active
                  </button>
                )}
              </div>

              {/* Order Cards */}
              {filteredOrders.length === 0 ? (
                <div className="bg-white rounded-3xl border border-neutral-200 p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-neutral-100 text-neutral-500 flex items-center justify-center mx-auto mb-4">
                    <Bell className="w-7 h-7" />
                  </div>
                  <h3 className="text-lg font-bold text-neutral-900 mb-1">
                    All caught up in this queue
                  </h3>
                  <p className="text-sm text-neutral-500 mb-5 max-w-md mx-auto">
                    New dine-in orders from Tables 1–6 slide in here automatically with customer
                    name, mobile number, and instant PDF bill generation.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/menu?table=3')}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#E5391B] text-white text-sm font-semibold hover:bg-[#C82E14] cursor-pointer"
                  >
                    Place a Test Order at Table 3
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <AnimatePresence initial={false}>
                    {filteredOrders.map((order) => {
                      const isBusy = busyOrderId === order.id;
                      const isSendingWa = sendingWaOrderId === order.id;
                      const isConfirmedStage = !['pending', 'rejected'].includes(order.status);

                      return (
                        <motion.article
                          key={order.id}
                          layout
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ duration: 0.22 }}
                          className={`bg-white rounded-3xl border p-5 sm:p-6 flex flex-col justify-between gap-4 ${
                            order.status === 'pending'
                              ? 'border-red-300 shadow-sm shadow-red-500/10'
                              : order.status === 'bill_requested'
                                ? 'border-amber-300 shadow-sm shadow-amber-500/10'
                                : 'border-neutral-200'
                          }`}
                        >
                          <div className="space-y-4">
                            {/* Header Row: Status + Customer Name + Mobile + Table + Order # */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p
                                  className={`text-xs font-extrabold tracking-wide ${
                                    order.status === 'pending'
                                      ? 'text-red-700'
                                      : order.status === 'bill_requested'
                                        ? 'text-amber-800'
                                        : order.status === 'preparing'
                                          ? 'text-amber-700'
                                          : order.status === 'rejected'
                                            ? 'text-red-700'
                                            : 'text-emerald-700'
                                  }`}
                                >
                                  {order.status === 'pending'
                                    ? 'NEW ORDER'
                                    : order.status === 'bill_requested'
                                      ? 'BILL REQUESTED'
                                      : order.status.replace('_', ' ').toUpperCase()}
                                </p>
                                <h3 className="text-xl font-extrabold text-neutral-900 truncate mt-0.5">
                                  {order.customer_name}
                                </h3>
                                <p className="text-xs font-mono font-semibold text-neutral-600 mt-0.5 inline-flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-neutral-400" />
                                  {formatIndianMobileDisplay(order.customer_mobile)}
                                </p>
                                <p className="text-xs font-semibold text-neutral-500 mt-1 tabular-nums">
                                  <span className="text-neutral-900 font-bold">
                                    Table {order.table_number}
                                  </span>{' '}
                                  · <span className="font-mono">#{order.order_code}</span> ·{' '}
                                  {formatRelativeTime(order.created_at, nowMs)}
                                </p>
                              </div>

                              <div className="text-right shrink-0">
                                <p className="text-xs text-neutral-500">Total</p>
                                <p className="font-mono text-2xl font-extrabold text-neutral-900 tabular-nums">
                                  {formatRupees(order.total)}
                                </p>
                                {order.discount > 0 && (
                                  <p className="text-[11px] font-bold text-emerald-700">
                                    Saved {formatRupees(order.discount)}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Order Items */}
                            <div className="bg-neutral-50 rounded-2xl p-4 space-y-1.5 tabular-nums">
                              {order.items.map((line) => (
                                <div
                                  key={line.menu_item_id}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <span className="font-semibold text-neutral-800">
                                    {line.name} × {line.quantity}
                                  </span>
                                  <span className="font-mono text-neutral-600">
                                    {formatRupees(line.line_total)}
                                  </span>
                                </div>
                              ))}
                              {order.notes && (
                                <p className="text-xs font-medium text-amber-800 pt-2 border-t border-neutral-200">
                                  Note: {order.notes}
                                </p>
                              )}
                            </div>

                            {/* Real Stored PDF Bill & WhatsApp Delivery Strip */}
                            {isConfirmedStage && (() => {
                              const billMeta = getBillStatusMeta(order);
                              const isBusySend =
                                isSendingWa ||
                                order.whatsapp_status === 'sending' ||
                                order.whatsapp_status === 'retrying';
                              const cardBillErr = billErrors[order.id];

                              return (
                                <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-3.5 space-y-2.5">
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="font-bold text-neutral-800 inline-flex items-center gap-1.5">
                                      <FileText className="w-3.5 h-3.5 text-[#E5391B]" />
                                      BILL READY
                                    </span>
                                    <span
                                      className={`font-extrabold inline-flex items-center gap-1.5 ${billMeta.color}`}
                                    >
                                      <span className={`w-2 h-2 rounded-full ${billMeta.dot}`} />
                                      {billMeta.label}
                                    </span>
                                  </div>

                                  {cardBillErr && (
                                    <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 flex items-center justify-between gap-2">
                                      <p className="text-[11px] font-semibold text-red-800 leading-snug">
                                        Bill generation failed: {cardBillErr}
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadPdf(order)}
                                        className="px-2.5 py-1 rounded-lg bg-red-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                                      >
                                        Try Again
                                      </button>
                                    </div>
                                  )}

                                  {order.whatsapp_status === 'failed' && order.whatsapp_error && (
                                    <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-[11px] font-semibold text-red-800 leading-snug">
                                        {order.whatsapp_error.toLowerCase().includes('not configured')
                                          ? 'WhatsApp API is not configured.'
                                          : order.whatsapp_error}
                                      </p>
                                      {order.whatsapp_error.toLowerCase().includes('not configured') && (
                                        <button
                                          type="button"
                                          onClick={() => setSection('settings')}
                                          className="px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                                        >
                                          <Settings className="w-3 h-3" />
                                          Open Settings
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <div className="grid grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewBillOrder(order)}
                                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-900 text-xs font-bold hover:bg-neutral-100 inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      View PDF
                                    </button>
                                    <button
                                      type="button"
                                      disabled={downloadingBillId === order.id}
                                      onClick={() => handleDownloadPdf(order)}
                                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {downloadingBillId === order.id ? 'Saving...' : 'Download'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusySend}
                                      onClick={() => handleSendWhatsApp(order)}
                                      className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                                        order.whatsapp_status === 'failed'
                                          ? 'bg-red-700 hover:bg-red-800'
                                          : 'bg-emerald-700 hover:bg-emerald-800'
                                      }`}
                                    >
                                      {isBusySend ? (
                                        <>
                                          <Clock className="w-3.5 h-3.5" />
                                          {order.whatsapp_status === 'retrying'
                                            ? 'Retrying'
                                            : 'Sending'}
                                        </>
                                      ) : order.whatsapp_status === 'failed' ? (
                                        <>
                                          <RefreshCw className="w-3.5 h-3.5" />
                                          Retry
                                        </>
                                      ) : order.whatsapp_status === 'sent' ? (
                                        <>
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          Sent
                                        </>
                                      ) : (
                                        <>
                                          <Send className="w-3.5 h-3.5" />
                                          Send Bill
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Primary POS Lifecycle Buttons */}
                          <div className="flex flex-wrap gap-2.5 pt-1">
                            {order.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(order, 'accepted')}
                                  className="flex-1 min-h-[50px] px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                                >
                                  <CheckCircle2 className="w-5 h-5" />
                                  Accept Order
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(order, 'rejected')}
                                  className="min-h-[50px] px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                >
                                  <XCircle className="w-5 h-5" />
                                  Reject
                                </button>
                              </>
                            )}

                            {order.status === 'accepted' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(order, 'preparing')}
                                className="w-full min-h-[50px] px-4 py-3 rounded-xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                              >
                                <ChefHat className="w-5 h-5" />
                                Preparing
                              </button>
                            )}

                            {order.status === 'preparing' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(order, 'ready')}
                                className="w-full min-h-[50px] px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                              >
                                <Utensils className="w-5 h-5" />
                                Mark Ready
                              </button>
                            )}

                            {(order.status === 'ready' || order.status === 'bill_requested') && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(order, 'bill_ready')}
                                className="w-full min-h-[50px] px-4 py-3 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                              >
                                <Receipt className="w-5 h-5" />
                                Mark Bill Ready
                              </button>
                            )}

                            {order.status === 'bill_ready' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(order, 'completed')}
                                className="w-full min-h-[50px] px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                              >
                                <Check className="w-5 h-5" />
                                Mark Completed
                              </button>
                            )}

                            {(order.status === 'completed' || order.status === 'rejected') && (
                              <div className="w-full text-center text-xs font-semibold text-neutral-500 py-1.5">
                                {order.status === 'completed'
                                  ? 'Completed & Table Available'
                                  : 'Order Rejected'}
                              </div>
                            )}
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Recent Bills Quick Strip on Dashboard */}
              {billOrders.length > 0 && (
                <div className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-extrabold text-neutral-900">Recent Bills</h3>
                      <p className="text-xs text-neutral-500">
                        Quick PDF access for latest confirmed orders
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSection('bills')}
                      className="text-xs font-bold text-[#E5391B] hover:underline cursor-pointer"
                    >
                      All Bills ({billOrders.length}) →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {billOrders.slice(0, 4).map((ord) => {
                      const bm = getBillStatusMeta(ord);
                      return (
                        <div
                          key={ord.id}
                          className="rounded-2xl border border-neutral-200 bg-neutral-50/50 p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-mono font-bold text-[#E5391B]">
                              #{ord.order_code} · Table {ord.table_number}
                            </p>
                            <p className="text-sm font-bold text-neutral-900 truncate">
                              {ord.customer_name} ·{' '}
                              <span className="font-mono">{formatRupees(ord.total)}</span>
                            </p>
                            <p className={`text-[11px] font-bold inline-flex items-center gap-1 mt-0.5 ${bm.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${bm.dot}`} />
                              {bm.label}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewBillOrder(ord)}
                              className="min-h-[36px] px-2.5 py-1 rounded-xl bg-white border border-neutral-200 text-xs font-bold text-neutral-800 hover:bg-neutral-100 cursor-pointer"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              disabled={downloadingBillId === ord.id}
                              onClick={() => handleDownloadPdf(ord)}
                              className="min-h-[36px] px-2.5 py-1 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 cursor-pointer disabled:opacity-60"
                            >
                              {downloadingBillId === ord.id ? '...' : 'PDF'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 2: MENU MANAGEMENT (ADD / EDIT / DELETE / OFFERS)  */}
          {/* ========================================================== */}
          {section === 'menu' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold text-neutral-900">Menu Management</h2>
                  <p className="text-sm text-neutral-500">
                    Add items, update regular or offer prices, and toggle stock in one tap.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(null);
                    setFocusOfferOnEdit(false);
                    setItemModalOpen(true);
                  }}
                  className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-5 h-5" />
                  Add Item
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {menuItems.map((item) => {
                  const effPrice = getEffectivePrice(item);
                  const offPct = getDiscountPercent(item.price, item.offer_price);
                  const confirmingDelete = confirmDeleteItemId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-2xl border border-neutral-200 overflow-hidden flex flex-col"
                    >
                      <div className="aspect-[16/10] w-full bg-neutral-100">
                        <FoodImage src={item.image} alt={item.name} className="w-full h-full" />
                      </div>
                      <div className="p-4 flex-1 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-neutral-500">
                              {CATEGORY_LABELS[item.category]}
                              {offPct > 0 && (
                                <span className="text-emerald-700 font-extrabold">
                                  {' '}
                                  · {offPct}% OFF
                                </span>
                              )}
                            </p>
                            <h3 className="text-base font-extrabold text-neutral-900 truncate mt-0.5">
                              {item.name}
                            </h3>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            {offPct > 0 && (
                              <p className="text-xs text-neutral-400 line-through">
                                {formatRupees(item.price)}
                              </p>
                            )}
                            <p className="text-base font-extrabold text-neutral-900">
                              {formatRupees(effPrice)}
                            </p>
                          </div>
                        </div>

                        <p className="text-xs text-neutral-500 line-clamp-2 flex-1">
                          {item.description}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100">
                          <button
                            type="button"
                            onClick={() => ownerToggleMenuItemAvailability(item)}
                            className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                              item.available
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                            }`}
                          >
                            {item.available ? 'Enabled' : 'Disabled'}
                          </button>

                          {confirmingDelete ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDeleteMenuItem(item.id)}
                                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteItemId(null)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItem(item);
                                  setFocusOfferOnEdit(true);
                                  setItemModalOpen(true);
                                }}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Tag className="w-3.5 h-3.5" />
                                Offer
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItem(item);
                                  setFocusOfferOnEdit(false);
                                  setItemModalOpen(true);
                                }}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-neutral-200 text-neutral-800 text-xs font-bold hover:bg-neutral-50 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteItemId(item.id)}
                                aria-label={`Delete ${item.name}`}
                                className="min-h-[36px] w-9 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 3: OFFERS MANAGEMENT                               */}
          {/* ========================================================== */}
          {section === 'offers' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold text-neutral-900">Special Offers</h2>
                  <p className="text-sm text-neutral-500">
                    Create combo deals — discount percentages are calculated automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingOffer(null);
                    setOfferModalOpen(true);
                  }}
                  className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#E5391B] text-white font-bold text-sm hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-5 h-5" />
                  Create Offer
                </button>
              </div>

              {offers.length === 0 ? (
                <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center">
                  <p className="text-base font-bold text-neutral-900 mb-1">No combo offers yet</p>
                  <p className="text-sm text-neutral-500 mb-4">
                    Create your first combo deal like Burger Combo ₹199 → ₹149 (25% OFF).
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {offers.map((offer) => {
                    const pct = getDiscountPercent(offer.regular_price, offer.offer_price);
                    const confirmingDelete = confirmDeleteOfferId === offer.id;
                    return (
                      <motion.div
                        key={offer.id}
                        layout
                        className={`bg-white rounded-2xl border overflow-hidden flex flex-col transition-opacity ${
                          offer.active ? 'border-[#E5391B]/30' : 'border-neutral-200 opacity-70'
                        }`}
                      >
                        <div className="aspect-[16/10] w-full bg-neutral-100">
                          <FoodImage src={offer.image} alt={offer.title} className="w-full h-full" />
                        </div>
                        <div className="p-5 flex-1 flex flex-col gap-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-extrabold text-[#E5391B]">{pct}% OFF</p>
                              <h3 className="text-lg font-extrabold text-neutral-900">
                                {offer.title}
                              </h3>
                            </div>
                            <div className="text-right font-mono tabular-nums">
                              <p className="text-xs text-neutral-400 line-through">
                                {formatRupees(offer.regular_price)}
                              </p>
                              <p className="text-lg font-extrabold text-neutral-900">
                                {formatRupees(offer.offer_price)}
                              </p>
                            </div>
                          </div>

                          <p className="text-xs text-neutral-600 flex-1">{offer.description}</p>

                          <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100">
                            <button
                              type="button"
                              onClick={() => ownerToggleOfferActive(offer)}
                              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                                offer.active
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                              }`}
                            >
                              {offer.active ? 'Active' : 'Paused'}
                            </button>

                            {confirmingDelete ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOffer(offer.id)}
                                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteOfferId(null)}
                                  className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingOffer(offer);
                                    setOfferModalOpen(true);
                                  }}
                                  className="min-h-[38px] px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteOfferId(offer.id)}
                                  aria-label={`Delete ${offer.title}`}
                                  className="min-h-[38px] w-9 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 4: TABLES (6 TABLES) + QR INSPECTOR                */}
          {/* ========================================================== */}
          {section === 'tables' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {liveTableSummaries.map(({ tableNumber, status, activeOrder }) => {
                  const statusMeta = TABLE_STATUS_META[status];
                  const isSelected = selectedTableNum === tableNumber;
                  const lastCompleted = !activeOrder
                    ? orders.find((o) => o.table_number === tableNumber && o.status === 'completed')
                    : null;
                  return (
                    <motion.button
                      key={tableNumber}
                      layout
                      whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                      transition={{ duration: 0.18 }}
                      type="button"
                      onClick={() => setSelectedTableNum(tableNumber)}
                      className={`text-left bg-white rounded-2xl border p-6 transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-[#E5391B] ring-2 ring-[#E5391B]/15'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xl font-extrabold text-neutral-900">
                          Table {tableNumber}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-bold ${statusMeta.colorClass}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                      </div>

                      {activeOrder ? (
                        <div className="space-y-1 text-sm text-neutral-600 tabular-nums">
                          <p className="font-bold text-neutral-900 truncate">
                            {activeOrder.customer_name}
                          </p>
                          <p className="font-mono text-xs text-neutral-600">
                            #{activeOrder.order_code} · {formatRupees(activeOrder.total)}
                          </p>
                        </div>
                      ) : lastCompleted ? (
                        <div className="space-y-0.5 text-xs text-neutral-500">
                          <p className="text-sm text-emerald-700 font-semibold">
                            Available · Last Completed
                          </p>
                          <p className="font-mono">
                            #{lastCompleted.order_code} · {formatRelativeTime(lastCompleted.updated_at || lastCompleted.created_at, nowMs)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-neutral-500">Available for dine-in guests.</p>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {selectedTableData && (
                <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-extrabold text-neutral-900">
                        Table {selectedTableData.tableNumber}
                      </h3>
                      <p className="text-sm text-neutral-500">
                        Status: {TABLE_STATUS_META[selectedTableData.status].label}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTableNum(null)}
                      aria-label="Close table inspector"
                      className="w-10 h-10 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {selectedTableData.activeOrder ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3 text-sm tabular-nums">
                        <span className="font-bold text-neutral-900">
                          {selectedTableData.activeOrder.customer_name}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-neutral-600">
                          {formatIndianMobileDisplay(selectedTableData.activeOrder.customer_mobile)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-bold text-[#E5391B]">
                          #{selectedTableData.activeOrder.order_code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-extrabold text-neutral-900">
                          {formatRupees(selectedTableData.activeOrder.total)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => setPreviewBillOrder(selectedTableData.activeOrder)}
                          className="min-h-[44px] px-4 py-2 rounded-xl border border-neutral-200 text-sm font-bold text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                        >
                          View Bill
                        </button>
                        {selectedTableData.activeOrder.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(selectedTableData.activeOrder!, 'accepted')
                            }
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold cursor-pointer"
                          >
                            Accept Order
                          </button>
                        )}
                        {selectedTableData.activeOrder.status === 'bill_ready' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(selectedTableData.activeOrder!, 'completed')
                            }
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold cursor-pointer"
                          >
                            Mark Completed
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-50 rounded-2xl p-5">
                      <p className="text-sm text-neutral-600">
                        No active order on Table {selectedTableData.tableNumber}.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate(`/menu?table=${selectedTableData.tableNumber}`)
                        }
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-semibold cursor-pointer whitespace-nowrap"
                      >
                        Open Table {selectedTableData.tableNumber} Menu
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 5: BILLS & WHATSAPP DELIVERY CENTER                */}
          {/* ========================================================== */}
          {section === 'bills' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold text-neutral-900">
                    Customer Bills &amp; WhatsApp
                  </h2>
                  <p className="text-sm text-neutral-500">
                    View, download, or deliver server-verified PDF bills to customer WhatsApp
                    numbers.
                  </p>
                </div>
                <span
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl border ${
                    whatsappConfigured
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {whatsappConfigured
                    ? 'WhatsApp Business API Ready'
                    : 'WhatsApp API Pending Setup (see Settings)'}
                </span>
              </div>

              {billOrders.length === 0 ? (
                <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center">
                  <p className="text-base font-bold text-neutral-900 mb-1">No bills generated yet</p>
                  <p className="text-sm text-neutral-500">
                    Confirmed customer orders automatically generate branded PDF bills here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {billOrders.map((order) => {
                    const billMeta = getBillStatusMeta(order);
                    const isBusySend =
                      sendingWaOrderId === order.id ||
                      order.whatsapp_status === 'sending' ||
                      order.whatsapp_status === 'retrying';
                    const cardBillErr = billErrors[order.id];

                    return (
                      <div
                        key={order.id}
                        className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-mono font-bold text-[#E5391B]">
                              Order #{order.order_code} · Table {order.table_number}
                            </p>
                            <h3 className="text-lg font-extrabold text-neutral-900 mt-0.5">
                              {order.customer_name}
                            </h3>
                            <p className="text-xs font-mono text-neutral-600">
                              {formatIndianMobileDisplay(order.customer_mobile)}
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="font-mono text-xl font-extrabold text-neutral-900">
                              {formatRupees(order.total)}
                            </p>
                            <p
                              className={`text-xs font-extrabold mt-1 inline-flex items-center gap-1.5 justify-end ${billMeta.color}`}
                            >
                              <span className={`w-2 h-2 rounded-full ${billMeta.dot}`} />
                              {billMeta.label}
                            </p>
                          </div>
                        </div>

                        {cardBillErr && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-red-800">
                              Bill generation failed: {cardBillErr}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleDownloadPdf(order)}
                              className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-bold shrink-0 cursor-pointer"
                            >
                              Try Again
                            </button>
                          </div>
                        )}

                        {order.whatsapp_status === 'failed' && order.whatsapp_error && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-red-800">
                              {order.whatsapp_error.toLowerCase().includes('not configured')
                                ? 'WhatsApp API is not configured.'
                                : order.whatsapp_error}
                            </p>
                            {order.whatsapp_error.toLowerCase().includes('not configured') && (
                              <button
                                type="button"
                                onClick={() => setSection('settings')}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                              >
                                <Settings className="w-3.5 h-3.5" />
                                Open Settings
                              </button>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewBillOrder(order)}
                            className="min-h-[42px] px-3 py-2 rounded-xl border border-neutral-200 text-neutral-900 text-xs font-bold hover:bg-neutral-50 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View PDF
                          </button>
                          <button
                            type="button"
                            disabled={downloadingBillId === order.id}
                            onClick={() => handleDownloadPdf(order)}
                            className="min-h-[42px] px-3 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingBillId === order.id ? 'Saving...' : 'Download'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusySend}
                            onClick={() => handleSendWhatsApp(order)}
                            className={`min-h-[42px] px-3 py-2 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                              order.whatsapp_status === 'failed'
                                ? 'bg-red-700 hover:bg-red-800'
                                : 'bg-emerald-700 hover:bg-emerald-800'
                            }`}
                          >
                            {isBusySend ? (
                              <>
                                <Clock className="w-3.5 h-3.5" />
                                {order.whatsapp_status === 'retrying' ? 'Retrying...' : 'Sending...'}
                              </>
                            ) : order.whatsapp_status === 'failed' ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5" />
                                Retry
                              </>
                            ) : order.whatsapp_status === 'sent' ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Bill Sent
                              </>
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5" />
                                Send Bill
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================== */}
          {/* SECTION 6: REAL SALES ANALYTICS, PDF REPORTS & HISTORY     */}
          {/* ========================================================== */}
          {section === 'reports' && (
            <OwnerAnalyticsSection
              orders={orders}
              onViewOrder={(ord) => setPreviewBillOrder(ord)}
              onDownloadBill={handleDownloadPdf}
              onSendWhatsApp={handleSendWhatsApp}
              downloadingBillId={downloadingBillId}
              sendingWaOrderId={sendingWaOrderId}
              onToast={showToast}
            />
          )}

          {/* ========================================================== */}
          {/* SECTION 7: SETTINGS & TABLE QR PRINT CENTER                */}
          {/* ========================================================== */}
          {section === 'settings' && (
            <div className="space-y-6">
              {/* WhatsApp API Integration Status Card */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900">
                      WhatsApp Business Cloud API
                    </h2>
                    <p className="text-sm text-neutral-600 mt-0.5">
                      Automatically uploads and delivers branded PDF bills to customer WhatsApp
                      numbers.
                    </p>
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1.5 rounded-xl border ${
                      whatsappConfigured
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    {whatsappConfigured ? 'Connected' : 'Not Configured'}
                  </span>
                </div>

                {!whatsappConfigured && (
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-xs text-neutral-700 space-y-1.5 leading-relaxed">
                    <p className="font-bold text-neutral-900">
                      How to activate automated WhatsApp PDF delivery:
                    </p>
                    <p>
                      Add <span className="font-mono font-semibold">WHATSAPP_ACCESS_TOKEN</span> and{' '}
                      <span className="font-mono font-semibold">WHATSAPP_PHONE_NUMBER_ID</span> in
                      AI Studio Settings → Secrets, then restart the server. Until configured, bills
                      still generate as downloadable PDFs and WhatsApp attempts honestly display
                      their failure reason with a Retry button.
                    </p>
                  </div>
                )}
              </div>

              {/* Printable 6-Table QR Codes */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900">
                      Table QR Codes (Tables 1–6)
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Print and place each unique QR card on its matching table.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    Print QR Cards
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {TABLE_NUMBERS.map((num) => {
                    const qrUrl = getTableQrUrl(num);
                    return (
                      <div
                        key={num}
                        className="rounded-2xl border border-neutral-200 p-5 flex flex-col items-center text-center"
                      >
                        <p className="text-xs font-bold text-[#E5391B]">RikZen Fast Food</p>
                        <h3 className="text-lg font-extrabold text-neutral-900 mb-3">
                          Table {num}
                        </h3>
                        <div className="p-2.5 bg-white rounded-xl border border-neutral-200 mb-3">
                          <QRCodeSVG value={qrUrl} size={128} level="M" fgColor="#111827" />
                        </div>
                        <p className="text-xs font-mono text-neutral-500 mb-3">/menu?table={num}</p>
                        <div className="w-full flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyQrUrl(num)}
                            className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-800 inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            {copiedTable === num ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate(`/menu?table=${num}`)}
                            className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Mobile Bottom Bar (Clean 5-Tab POS Navigation) */}
        <nav
          aria-label="Owner quick navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-neutral-200 grid grid-cols-5"
        >
          {[
            { id: 'dashboard' as const, label: 'Dashboard', icon: Home, badge: 0 },
            { id: 'menu' as const, label: 'Menu', icon: Utensils, badge: 0 },
            { id: 'orders_jump' as const, label: 'Orders', icon: Receipt, badge: urgentCount },
            { id: 'reports' as const, label: 'Sales', icon: BarChart3, badge: 0 },
            { id: 'settings' as const, label: 'Settings', icon: Settings, badge: 0 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.id === 'orders_jump'
                ? section === 'bills' || (section === 'dashboard' && orderFilter !== 'all_active')
                : section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === 'orders_jump') {
                    setSection('dashboard');
                    window.setTimeout(() => {
                      liveOrdersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 60);
                  } else {
                    setSection(tab.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className={`relative flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  active ? 'text-[#E5391B]' : 'text-neutral-500'
                }`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E5391B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Modals */}
      <MenuItemModal
        open={itemModalOpen}
        editingItem={editingItem}
        focusOffer={focusOfferOnEdit}
        onClose={() => {
          setItemModalOpen(false);
          setFocusOfferOnEdit(false);
        }}
      />

      <OfferModal
        open={offerModalOpen}
        editingOffer={editingOffer}
        onClose={() => setOfferModalOpen(false)}
      />

      {livePreviewOrder && (
        <BillPreviewModal
          order={livePreviewOrder}
          onClose={() => setPreviewBillOrder(null)}
          isOwnerView={true}
          whatsappConfigured={whatsappConfigured}
          onSendWhatsApp={handleSendWhatsApp}
          onOpenSettings={() => setSection('settings')}
          isSendingWhatsApp={sendingWaOrderId === livePreviewOrder.id}
        />
      )}
    </div>
  );
};
