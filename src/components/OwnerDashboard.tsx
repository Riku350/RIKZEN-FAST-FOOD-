import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChefHat,
  Copy,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FolderArchive,
  Gift,
  Globe,
  Home,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  Mic,
  Phone,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Save,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Square,
  Tag,
  Trash2,
  TrendingUp,
  Upload,
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
import { shareBillNative } from '../lib/billShare';
import {
  auth,
  BOOTSTRAPPED_OWNER_EMAIL,
  FIREBASE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  googleProvider,
} from '../lib/firebase';
import {
  canCancelOrderStatus,
  downloadOrderBillPdf,
  downloadSalesReportPdf,
  ensureOrderPdfGenerated,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRelativeTime,
  formatRupees,
  getTableQrUrl,
  isCancelledOrderStatus,
  OwnerAuthStatus,
  ownerCancelOrder,
  ownerClearOrderHistory,
  ownerDeleteMenuItem,
  ownerDeleteOffer,
  ownerDeletePaymentQr,
  ownerSavePaymentSettings,
  OwnerSystemDiagnosticsReport,
  ownerToggleMenuItemAvailability,
  ownerToggleOfferActive,
  ownerUpdateOrderStatus,
  ownerUpdatePaymentStatus,
  ownerUploadPaymentQrImage,
  playKitchenAlertChime,
  runOwnerSystemDiagnostics,
  seedOwnerShopDataIfNeeded,
  subscribeToAllOrders,
  subscribeToMenuItems,
  subscribeToOffers,
  subscribeToPaymentSettings,
  subscribeToTables,
  syncCatalogToServer,
  syncOwnerOrderRecoveryIndex,
  syncPaymentSettingsToServer,
  timestampToDate,
  verifyOwnerAuthorization,
} from '../lib/orderService';
import {
  buildHourlySalesSeries,
  getDailyReportFilename,
  isRevenueOrder,
} from '../lib/salesAnalytics';
import {
  decodeUpiQrFromImageFile,
  downloadAllTableQrsZip,
  downloadMainMenuQrPng,
  downloadSingleTableQrPng,
  getMainMenuQrUrl,
} from '../lib/tableQrExport';
import { buildDynamicUpiUri, DEFAULT_PAYMENT_SETTINGS, isValidUpiId } from '../lib/upiPayment';
import {
  playOrderNotificationBell,
  VoiceAlertSettings,
  VoiceLanguageMode,
  voiceOrderAlertManager,
  VoiceQueueState,
  VoiceSpeed,
} from '../lib/voiceOrderAlert';
import {
  getDiscountPercent,
  getEffectivePrice,
  MenuCategoryId,
  MenuItem,
  OfferRecord,
  OrderRecord,
  OrderStatus,
  PaymentMode,
  PaymentSettings,
  PaymentStatus,
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

interface OwnerDiagnosticInfo {
  operation: string;
  path: string;
  status: string;
  reason: string;
  suggestedFix: string;
}

function parseOwnerDiagnosticError(raw: string): OwnerDiagnosticInfo {
  try {
    const parsed = JSON.parse(raw) as {
      error?: string;
      operationType?: string;
      path?: string;
    };
    if (parsed && typeof parsed === 'object' && (parsed.error || parsed.operationType || parsed.path)) {
      const reason = parsed.error || raw;
      const isPerm = reason.toLowerCase().includes('permission');
      return {
        operation: (parsed.operationType || 'unknown').toUpperCase(),
        path: parsed.path || 'Firestore',
        status: isPerm ? 'PERMISSION_DENIED' : 'FIRESTORE_ERROR',
        reason,
        suggestedFix: isPerm
          ? `Confirm you are signed in with the authorized owner account (${BOOTSTRAPPED_OWNER_EMAIL}) and click Retry.`
          : 'Check your network connection and click Retry to re-sync live shop data.',
      };
    }
  } catch {
    // Plain error string
  }
  const isPerm = raw.toLowerCase().includes('permission');
  return {
    operation: 'REQUEST',
    path: 'Owner POS',
    status: isPerm ? 'PERMISSION_DENIED' : 'ERROR',
    reason: raw,
    suggestedFix: isPerm
      ? `Sign out and sign back in with ${BOOTSTRAPPED_OWNER_EMAIL} to refresh your owner session.`
      : 'Review the error details above and click Retry.',
  };
}

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
  const [ownerAuthStatus, setOwnerAuthStatus] = useState<OwnerAuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Navigation & filter state (with browser history support for Back button)
  const [section, setSectionState] = useState<OwnerSection>('dashboard');
  const [sectionStack, setSectionStack] = useState<OwnerSection[]>([]);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all_active');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(CANONICAL_MENU_ITEMS);
  const [offers, setOffers] = useState<OfferRecord[]>(CANONICAL_OFFERS);
  const [dataError, setDataError] = useState<string | null>(null);
  const [retryingDiagnostic, setRetryingDiagnostic] = useState(false);
  const lastFailedActionRef = useRef<(() => Promise<void>) | null>(null);
  const lastRecoverySyncRef = useRef<number>(0);

  // Action busy states
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [sharingBillId, setSharingBillId] = useState<string | null>(null);
  const [downloadingBillId, setDownloadingBillId] = useState<string | null>(null);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(null);
  const [billErrors, setBillErrors] = useState<Record<string, string>>({});
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [confirmDeleteOfferId, setConfirmDeleteOfferId] = useState<string | null>(null);

  // Order Cancellation modal state
  const [cancelModalOrder, setCancelModalOrder] = useState<OrderRecord | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState(false);

  // Clear Order History modal & System Diagnostics state (Admin Settings)
  const [clearHistoryModalOpen, setClearHistoryModalOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [diagnosticsReport, setDiagnosticsReport] = useState<OwnerSystemDiagnosticsReport | null>(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);

  // Honest 2-mode Payment Settings state (Uploaded Payment QR OR Dynamic Exact-Amount UPI QR)
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [paymentDraft, setPaymentDraft] = useState<{
    payment_mode: PaymentMode;
    upi_id: string;
    merchant_name: string;
    qr_image_url: string;
  }>({
    payment_mode: DEFAULT_PAYMENT_SETTINGS.payment_mode,
    upi_id: DEFAULT_PAYMENT_SETTINGS.upi_id,
    merchant_name: DEFAULT_PAYMENT_SETTINGS.merchant_name,
    qr_image_url: DEFAULT_PAYMENT_SETTINGS.qr_image_url,
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [deletingQr, setDeletingQr] = useState(false);
  const [testQrModalOpen, setTestQrModalOpen] = useState(false);
  const [qrScanNotice, setQrScanNotice] = useState<string | null>(null);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const paymentDraftDirtyRef = useRef(false);

  // Table & Main Website QR Download & Print state
  const [downloadingTableQr, setDownloadingTableQr] = useState<number | 'all' | 'main' | null>(null);
  const [printQrTargets, setPrintQrTargets] = useState<Array<number | 'main'>>([...TABLE_NUMBERS]);

  // Modals & inspector state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [focusOfferOnEdit, setFocusOfferOnEdit] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<OfferRecord | null>(null);
  const [previewBillOrder, setPreviewBillOrder] = useState<OrderRecord | null>(null);
  const [selectedTableNum, setSelectedTableNum] = useState<number | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceAlertSettings>(() =>
    voiceOrderAlertManager.getSettings(),
  );
  const [voiceQueueState, setVoiceQueueState] = useState<VoiceQueueState>(() =>
    voiceOrderAlertManager.getState(),
  );
  const [dismissedVoiceError, setDismissedVoiceError] = useState<string | null>(null);
  const [copiedTable, setCopiedTable] = useState<number | 'main' | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [liveAlertOrders, setLiveAlertOrders] = useState<OrderRecord[]>([]);
  const [quickReportBusy, setQuickReportBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const prefersReducedMotion = useReducedMotion();

  const knownOrderStatusesRef = useRef<Map<string, OrderStatus>>(new Map());
  const knownPaymentStatusesRef = useRef<Map<string, PaymentStatus>>(new Map());
  const seenNewOrderIdsRef = useRef<Set<string>>(new Set());
  const initialOrdersLoadedRef = useRef(false);
  const voiceSettingsRef = useRef<VoiceAlertSettings>(voiceSettings);
  const liveOrdersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    const unsubVoice = voiceOrderAlertManager.subscribe((next) => {
      setVoiceQueueState(next);
      setVoiceSettings(voiceOrderAlertManager.getSettings());
      if (next.lastError && next.lastError !== dismissedVoiceError) {
        setDismissedVoiceError(null);
      }
    });
    return () => {
      unsubVoice();
    };
  }, [dismissedVoiceError]);

  // Automatically unlock browser AudioContext & SpeechSynthesis on ANY interaction
  // inside the Owner Dashboard so new order voice announcements speak without extra clicks.
  useEffect(() => {
    if (!isOwner) return;
    const handleGesture = () => {
      void voiceOrderAlertManager.unlockOnUserGesture().then(() => {
        setVoiceSettings(voiceOrderAlertManager.getSettings());
      });
    };
    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('touchstart', handleGesture, { passive: true });
    window.addEventListener('click', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [isOwner]);

  const setSection = (nextSection: OwnerSection) => {
    if (nextSection === section) {
      if (selectedTableNum !== null) setSelectedTableNum(null);
      return;
    }
    setSelectedTableNum(null);
    setSectionStack((prev) => [...prev.slice(-12), section]);
    setSectionState(nextSection);
    try {
      const state = { rikzenOwnerSection: nextSection };
      window.history.pushState(state, '', window.location.pathname + window.location.search);
    } catch {
      // Ignore history errors in restricted frames
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminBack = () => {
    if (selectedTableNum !== null) {
      setSelectedTableNum(null);
      return;
    }
    if (sectionStack.length > 0) {
      const prevSection = sectionStack[sectionStack.length - 1];
      setSectionStack((prev) => prev.slice(0, -1));
      setSectionState(prevSection);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (section !== 'dashboard') {
      setSectionState('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const onPopState = (ev: PopStateEvent) => {
      const st = ev.state as { rikzenOwnerSection?: OwnerSection } | null;
      if (st?.rikzenOwnerSection) {
        setSelectedTableNum(null);
        setSectionState(st.rikzenOwnerSection);
      } else if (section !== 'dashboard') {
        setSelectedTableNum(null);
        setSectionState('dashboard');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [section]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((curr) => (curr === msg ? null : curr)), 3200);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Auth listener (authoritative role verification)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (nextUser) {
        const status = await verifyOwnerAuthorization(nextUser);
        setOwnerAuthStatus(status);
        setIsOwner(status.isAuthorizedOwner);
        if (status.isAuthorizedOwner) {
          try {
            await seedOwnerShopDataIfNeeded(nextUser);
          } catch (err) {
            setDataError(err instanceof Error ? err.message : 'Unable to initialize shop data.');
          }
        }
      } else {
        setOwnerAuthStatus(null);
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
      knownPaymentStatusesRef.current.clear();
      return;
    }

    setDataError(null);

    const unsubOrders = subscribeToAllOrders(
      (incomingOrders) => {
        if (!initialOrdersLoadedRef.current) {
          // Mark all pre-existing orders as seen so refreshing the page NEVER announces old orders
          for (const ord of incomingOrders) {
            seenNewOrderIdsRef.current.add(ord.id);
            voiceOrderAlertManager.markOrderAlreadySeen(ord.id);
          }
        } else {
          const freshlyArrivedPending: OrderRecord[] = [];
          let billOrPaymentRequestedChime = false;

          for (const ord of incomingOrders) {
            const prevStatus = knownOrderStatusesRef.current.get(ord.id);
            const prevPayStatus = knownPaymentStatusesRef.current.get(ord.id);
            const isGenuinelyNewPending =
              !prevStatus &&
              ord.status === 'pending' &&
              !seenNewOrderIdsRef.current.has(ord.id) &&
              !voiceOrderAlertManager.hasBeenAnnounced(ord.id);

            if (isGenuinelyNewPending) {
              seenNewOrderIdsRef.current.add(ord.id);
              freshlyArrivedPending.push(ord);
            } else if (
              prevStatus &&
              prevStatus !== 'bill_requested' &&
              ord.status === 'bill_requested'
            ) {
              billOrPaymentRequestedChime = true;
            } else if (
              prevPayStatus !== 'verification_requested' &&
              ord.payment_status === 'verification_requested'
            ) {
              billOrPaymentRequestedChime = true;
            }
          }

          if (freshlyArrivedPending.length > 0) {
            // Announce oldest-first so simultaneous orders play in natural arrival order
            const chronological = [...freshlyArrivedPending].reverse();
            for (const newOrd of chronological) {
              voiceOrderAlertManager.enqueueOrder(newOrd);
            }
            setLiveAlertOrders((prev) => {
              const existingIds = new Set(prev.map((o) => o.id));
              const additions = freshlyArrivedPending.filter((o) => !existingIds.has(o.id));
              return [...additions, ...prev].slice(0, 6);
            });
          } else if (billOrPaymentRequestedChime && voiceSettingsRef.current.enabled) {
            playKitchenAlertChime('bill');
          }
        }

        // Keep live alert popup cards synced with Firestore (auto-remove once confirmed/rejected)
        const pendingById = new Map<string, OrderRecord>();
        const nextMap = new Map<string, OrderStatus>();
        const nextPayMap = new Map<string, PaymentStatus>();
        for (const ord of incomingOrders) {
          nextMap.set(ord.id, ord.status);
          nextPayMap.set(ord.id, ord.payment_status);
          if (ord.status === 'pending') {
            pendingById.set(ord.id, ord);
          }
        }
        setLiveAlertOrders((prev) =>
          prev
            .filter((o) => pendingById.has(o.id))
            .map((o) => pendingById.get(o.id) || o),
        );

        knownOrderStatusesRef.current = nextMap;
        knownPaymentStatusesRef.current = nextPayMap;
        initialOrdersLoadedRef.current = true;
        setOrders(incomingOrders);

        // Keep server-side Find My Order index synced with latest Firestore statuses/payments
        const nowMs = Date.now();
        if (nowMs - lastRecoverySyncRef.current >= 2500) {
          lastRecoverySyncRef.current = nowMs;
          void syncOwnerOrderRecoveryIndex(incomingOrders);
        }
      },
      (err) => setDataError(err.message),
    );

    const unsubTables = subscribeToTables(
      (incomingTables) => setTables(incomingTables),
      (err) => setDataError(err.message),
    );

    const unsubMenu = subscribeToMenuItems((items) => setMenuItems(items));
    const unsubOffers = subscribeToOffers((list) => setOffers(list));
    const unsubPayment = subscribeToPaymentSettings((settings) => {
      setPaymentSettings(settings);
      if (!paymentDraftDirtyRef.current) {
        setPaymentDraft({
          payment_mode: settings.payment_mode,
          upi_id: settings.upi_id,
          merchant_name: settings.merchant_name,
          qr_image_url: settings.qr_image_url,
        });
      }
      void syncPaymentSettingsToServer(settings);
    });

    return () => {
      unsubOrders();
      unsubTables();
      unsubMenu();
      unsubOffers();
      unsubPayment();
    };
  }, [authReady, user, isOwner]);

  // Restore all 6 table cards after printing a single card
  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintQrTargets([...TABLE_NUMBERS]);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

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
    voiceOrderAlertManager.stopAndClearQueue();
    await signOut(auth);
  };

  const handleEnableSoundAlerts = async () => {
    const unlocked = await voiceOrderAlertManager.enableSound();
    setVoiceSettings(voiceOrderAlertManager.getSettings());
    setDismissedVoiceError(null);
    if (unlocked) {
      await playOrderNotificationBell(voiceSettings.volume);
      showToast('Voice order alerts enabled (Indian Female voice ready).');
    } else {
      showToast('Unable to unlock browser audio. Please check browser sound permissions.');
    }
  };

  const handleToggleVoiceEnabled = async () => {
    const nextEnabled = !voiceSettings.enabled;
    if (nextEnabled) {
      await voiceOrderAlertManager.enableSound();
    }
    const updated = voiceOrderAlertManager.updateSettings({ enabled: nextEnabled });
    setVoiceSettings(updated);
    showToast(nextEnabled ? 'Voice order announcements ON.' : 'Voice order announcements OFF.');
  };

  const handleChangeVoiceVolume = (nextVolume: number) => {
    const updated = voiceOrderAlertManager.updateSettings({ volume: nextVolume });
    setVoiceSettings(updated);
  };

  const handleChangeVoiceSpeed = (nextSpeed: VoiceSpeed) => {
    const updated = voiceOrderAlertManager.updateSettings({ speed: nextSpeed });
    setVoiceSettings(updated);
  };

  const handleChangeVoiceLanguage = (nextLang: VoiceLanguageMode) => {
    const updated = voiceOrderAlertManager.updateSettings({ language: nextLang });
    setVoiceSettings(updated);
  };

  const handleTestVoiceAnnouncement = async () => {
    setDismissedVoiceError(null);
    setVoiceSettings(voiceOrderAlertManager.updateSettings({ soundActivated: true }));
    await voiceOrderAlertManager.playTestAnnouncement();
  };

  const handleReplayOrderVoice = async (order: OrderRecord) => {
    setDismissedVoiceError(null);
    await voiceOrderAlertManager.replayOrder(order);
    setVoiceSettings(voiceOrderAlertManager.getSettings());
  };

  const handleShareBill = async (order: OrderRecord) => {
    if (sharingBillId) return;
    setSharingBillId(order.id);
    try {
      let publicBillId = order.public_bill_id || '';
      if (!publicBillId || !order.pdf_url) {
        const generated = await ensureOrderPdfGenerated(order, { persistIfOwner: true });
        publicBillId = generated.public_bill_id || publicBillId;
      }
      const outcome = await shareBillNative({
        order_code: order.order_code,
        table_number: order.table_number,
        customer_name: order.customer_name,
        total: order.total,
        public_bill_id: publicBillId,
        pdf_url: order.pdf_url,
      });
      if (outcome.method !== 'cancelled') {
        showToast(outcome.message);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to share bill right now.');
    } finally {
      setSharingBillId(null);
    }
  };

  const handleStatusChange = async (
    order: OrderRecord,
    nextStatus: OrderStatus,
  ): Promise<boolean> => {
    if (busyOrderId) return false;
    void voiceOrderAlertManager.unlockOnUserGesture();
    setBusyOrderId(order.id);
    setDataError(null);
    lastFailedActionRef.current = null;
    try {
      await ownerUpdateOrderStatus(order, nextStatus);
      if (nextStatus === 'accepted' || nextStatus === 'confirmed') {
        showToast(`Order #${order.order_code} confirmed & customer bill is ready.`);
      } else if (nextStatus === 'preparing') {
        showToast(`Order #${order.order_code} is now preparing.`);
      } else if (nextStatus === 'ready') {
        showToast(`Order #${order.order_code} marked ready to serve.`);
      } else if (nextStatus === 'bill_ready') {
        showToast(`Bill ready for Table ${order.table_number}.`);
      } else if (nextStatus === 'completed') {
        showToast(`Table ${order.table_number} completed & available.`);
      } else if (nextStatus === 'cancelled' || nextStatus === 'rejected') {
        showToast(`Order #${order.order_code} cancelled & Table ${order.table_number} freed.`);
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not update order status.';
      console.error('[OwnerDashboard Status Update Error]', { orderId: order.id, nextStatus, err });
      lastFailedActionRef.current = async () => {
        await ownerUpdateOrderStatus(order, nextStatus);
      };
      setDataError(msg);
      showToast(`Order update failed: ${msg}`);
      return false;
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleConfirmCancelOrder = async () => {
    if (!cancelModalOrder || cancellingOrder) return;
    const target = cancelModalOrder;
    setCancellingOrder(true);
    setDataError(null);
    try {
      await ownerCancelOrder(target);
      setLiveAlertOrders((prev) => prev.filter((o) => o.id !== target.id));
      setCancelModalOrder(null);
      showToast(`Order #${target.order_code} cancelled. Customer notified.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not cancel order.';
      lastFailedActionRef.current = async () => {
        await ownerCancelOrder(target);
      };
      setDataError(msg);
      showToast(`Cancel failed: ${msg}`);
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleDiagnosticRetry = async () => {
    if (retryingDiagnostic) return;
    setRetryingDiagnostic(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setDataError('Session expired. Please sign in again with your owner account.');
        return;
      }
      // 1. Force refresh Firebase ID token and re-verify owner role
      await currentUser.getIdToken(true);
      const refreshedAuth = await verifyOwnerAuthorization(currentUser, { forceRefresh: true });
      setOwnerAuthStatus(refreshedAuth);
      setIsOwner(refreshedAuth.isAuthorizedOwner);
      if (!refreshedAuth.isAuthorizedOwner) {
        setDataError(`Owner authorization check failed: ${refreshedAuth.reason}`);
        return;
      }
      // 2. Retry the exact failed operation if recorded
      if (lastFailedActionRef.current) {
        const retryFn = lastFailedActionRef.current;
        await retryFn();
        lastFailedActionRef.current = null;
        setDataError(null);
        showToast('Auth refreshed & failed action completed successfully.');
      } else {
        setDataError(null);
        showToast('Owner session refreshed and verified.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Retry failed.';
      setDataError(msg);
    } finally {
      setRetryingDiagnostic(false);
    }
  };

  const handleRunSystemTest = async () => {
    if (runningDiagnostics) return;
    setRunningDiagnostics(true);
    try {
      const report = await runOwnerSystemDiagnostics();
      setDiagnosticsReport(report);
      setOwnerAuthStatus(report.auth);
      showToast('System diagnostic test completed.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'System test failed.');
    } finally {
      setRunningDiagnostics(false);
    }
  };

  const handleConfirmClearOrderHistory = async () => {
    if (clearingHistory) return;
    setClearingHistory(true);
    setDataError(null);
    try {
      const { deletedCount } = await ownerClearOrderHistory();
      setClearHistoryModalOpen(false);
      setLiveAlertOrders([]);
      setSelectedTableNum(null);
      showToast(
        deletedCount > 0
          ? `✅ Order history cleared successfully (${deletedCount} orders removed).`
          : '✅ Order history cleared successfully.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to clear order history.';
      setDataError(msg);
      showToast(`Clear history failed: ${msg}`);
    } finally {
      setClearingHistory(false);
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
        return { label: 'Generating Bill...', color: 'text-amber-700', dot: 'bg-amber-500' };
      case 'failed':
        return { label: 'Bill Failed', color: 'text-red-700', dot: 'bg-red-600' };
      case 'generated':
        return { label: 'Bill Ready', color: 'text-emerald-700', dot: 'bg-emerald-600' };
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

  const handleCopyMainQrUrl = async () => {
    try {
      await navigator.clipboard.writeText(getMainMenuQrUrl());
      setCopiedTable('main');
      window.setTimeout(() => setCopiedTable(null), 1800);
    } catch {
      // Ignore clipboard errors
    }
  };

  const handleMarkPaid = async (order: OrderRecord) => {
    if (updatingPaymentId) return;
    setUpdatingPaymentId(order.id);
    setDataError(null);
    lastFailedActionRef.current = null;
    try {
      await ownerUpdatePaymentStatus(order, 'paid');
      showToast(`✅ Payment verified & received for #${order.order_code}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not update payment status.';
      lastFailedActionRef.current = async () => {
        await ownerUpdatePaymentStatus(order, 'paid');
      };
      setDataError(msg);
    } finally {
      setUpdatingPaymentId(null);
    }
  };

  const handleMarkPaymentNotReceived = async (order: OrderRecord) => {
    if (updatingPaymentId) return;
    setUpdatingPaymentId(order.id);
    setDataError(null);
    lastFailedActionRef.current = null;
    try {
      await ownerUpdatePaymentStatus(order, 'not_received');
      showToast(`Marked payment not received for #${order.order_code}. Customer notified.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not update payment status.';
      lastFailedActionRef.current = async () => {
        await ownerUpdatePaymentStatus(order, 'not_received');
      };
      setDataError(msg);
    } finally {
      setUpdatingPaymentId(null);
    }
  };

  const handleUploadPaymentQrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingQr(true);
    setPaymentFormError(null);
    setQrScanNotice(null);
    try {
      const decoded = await decodeUpiQrFromImageFile(file);
      const uploadedUrl = await ownerUploadPaymentQrImage(file);

      paymentDraftDirtyRef.current = true;
      setPaymentDraft((prev) => ({
        payment_mode: 'uploaded_qr',
        upi_id: decoded.upiId || prev.upi_id,
        merchant_name: decoded.merchantName || prev.merchant_name || 'RikZen Fast Food',
        qr_image_url: uploadedUrl,
      }));

      if (decoded.upiId) {
        setQrScanNotice(
          `QR uploaded & UPI ID detected (${decoded.upiId}). Keep "Uploaded Payment QR" to show your exact QR image, or switch to "Dynamic UPI QR" for exact pre-filled amounts, then click Save.`,
        );
      } else {
        setQrScanNotice(
          'Payment QR uploaded cleanly! Preview below and click Save Payment Settings to activate it for new bills.',
        );
      }
    } catch (err) {
      setPaymentFormError(
        err instanceof Error ? err.message : 'Unable to upload or read payment QR image.',
      );
    } finally {
      setUploadingQr(false);
    }
  };

  const handleDeletePaymentQr = async () => {
    if (deletingQr) return;
    setDeletingQr(true);
    setPaymentFormError(null);
    setQrScanNotice(null);
    try {
      const updated = await ownerDeletePaymentQr({
        ...paymentSettings,
        payment_mode: paymentDraft.payment_mode,
        upi_id: paymentDraft.upi_id,
        merchant_name: paymentDraft.merchant_name,
        qr_image_url: paymentDraft.qr_image_url,
      });
      paymentDraftDirtyRef.current = false;
      setPaymentSettings(updated);
      setPaymentDraft({
        payment_mode: updated.payment_mode,
        upi_id: updated.upi_id,
        merchant_name: updated.merchant_name,
        qr_image_url: updated.qr_image_url,
      });
      showToast('Uploaded payment QR removed.');
    } catch (err) {
      setPaymentFormError(err instanceof Error ? err.message : 'Could not delete payment QR.');
    } finally {
      setDeletingQr(false);
    }
  };

  const handleSavePaymentSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPayment) return;
    setPaymentFormError(null);
    setQrScanNotice(null);

    const trimmedUpi = paymentDraft.upi_id.trim();
    if (trimmedUpi !== '' && !isValidUpiId(trimmedUpi)) {
      setPaymentFormError(
        'Please enter a valid UPI ID (example: rikzenfastfood@okaxis or 9876543210@ybl).',
      );
      return;
    }
    if (paymentDraft.payment_mode === 'dynamic_upi' && !trimmedUpi) {
      setPaymentFormError('Enter your Restaurant UPI ID to use Dynamic Exact-Amount UPI QR mode.');
      return;
    }
    if (paymentDraft.payment_mode === 'uploaded_qr' && !paymentDraft.qr_image_url.trim()) {
      setPaymentFormError('Please upload your restaurant payment QR image first.');
      return;
    }

    setSavingPayment(true);
    try {
      const saved = await ownerSavePaymentSettings({
        payment_mode: paymentDraft.payment_mode,
        upi_id: trimmedUpi,
        merchant_name: paymentDraft.merchant_name.trim() || 'RikZen Fast Food',
        qr_image_url: paymentDraft.qr_image_url.trim(),
      });
      paymentDraftDirtyRef.current = false;
      setPaymentSettings(saved);
      showToast('Payment QR saved successfully.');
    } catch (err) {
      setPaymentFormError(
        err instanceof Error ? err.message : 'Could not save payment settings.',
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDownloadSingleTableQr = async (tableNum: number) => {
    if (downloadingTableQr !== null) return;
    setDownloadingTableQr(tableNum);
    try {
      const filename = await downloadSingleTableQrPng(tableNum);
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download Table QR PNG.');
    } finally {
      setDownloadingTableQr(null);
    }
  };

  const handleDownloadMainMenuQr = async () => {
    if (downloadingTableQr !== null) return;
    setDownloadingTableQr('main');
    try {
      const filename = await downloadMainMenuQrPng();
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download Main Website QR PNG.');
    } finally {
      setDownloadingTableQr(null);
    }
  };

  const handleDownloadAllTableQrs = async () => {
    if (downloadingTableQr !== null) return;
    setDownloadingTableQr('all');
    try {
      const filename = await downloadAllTableQrsZip();
      showToast(`Downloaded ${filename} (Tables 1–6 + Main QR)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate Table QR ZIP.');
    } finally {
      setDownloadingTableQr(null);
    }
  };

  const handlePrintTableQrs = (targets: Array<number | 'main'>) => {
    setPrintQrTargets(targets);
    window.setTimeout(() => {
      window.print();
    }, 120);
  };

  // Live 6-Table derived status
  const liveTableSummaries = useMemo(() => {
    const activeByTable = new Map<number, OrderRecord>();
    for (const order of orders) {
      if (
        !['completed', 'rejected', 'cancelled'].includes(order.status) &&
        !activeByTable.has(order.table_number)
      ) {
        activeByTable.set(order.table_number, order);
      }
    }

    return TABLE_NUMBERS.map((num) => {
      const activeOrder = activeByTable.get(num) || null;
      const stored = tables.find((t) => t.table_number === num);
      let status: TableStatus = 'available';
      if (activeOrder) {
        if (
          activeOrder.status === 'pending' ||
          activeOrder.status === 'accepted' ||
          activeOrder.status === 'confirmed'
        )
          status = 'ordering';
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

  // Order Stage Counts & Real Paid-Only Revenue KPIs
  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    const todaysActive = orders.filter(
      (o) =>
        timestampToDate(o.created_at).getTime() >= todayMs && !isCancelledOrderStatus(o.status),
    );
    // STRICT MANUAL PAYMENT REVENUE RULE: Only manually verified paid orders count toward revenue
    const todaysPaidOrders = todaysActive.filter(isRevenueOrder);
    const todaysSales = todaysPaidOrders.reduce((sum, o) => sum + o.total, 0);
    const todaysDiscounts = todaysPaidOrders.reduce((sum, o) => sum + (o.discount || 0), 0);

    const newCount = orders.filter((o) => o.status === 'pending').length;
    const preparingCount = orders.filter(
      (o) => o.status === 'accepted' || o.status === 'confirmed' || o.status === 'preparing',
    ).length;
    const readyCount = orders.filter((o) => o.status === 'ready').length;
    const billReqCount = orders.filter(
      (o) => o.status === 'bill_requested' || o.status === 'bill_ready',
    ).length;
    const completedCount = orders.filter((o) => o.status === 'completed').length;
    const todaysPaidCount = todaysPaidOrders.length;
    const todaysPendingPaymentCount = todaysActive.filter(
      (o) => o.payment_status !== 'paid',
    ).length;
    const activeTablesCount = liveTableSummaries.filter((t) => t.status !== 'available').length;

    return {
      todaysOrders: todaysActive.length,
      todaysCompletedCount: todaysPaidOrders.length,
      todaysPaidCount,
      todaysPendingPaymentCount,
      todaysSales,
      todaysDiscounts,
      avgOrderValue:
        todaysPaidOrders.length > 0 ? Math.round(todaysSales / todaysPaidOrders.length) : 0,
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
          return !['completed', 'rejected', 'cancelled'].includes(o.status);
        case 'pending':
          return o.status === 'pending';
        case 'preparing':
          return o.status === 'accepted' || o.status === 'confirmed' || o.status === 'preparing';
        case 'ready':
          return o.status === 'ready';
        case 'bill_requested':
          return o.status === 'bill_requested' || o.status === 'bill_ready';
        case 'completed':
          return o.status === 'completed' || isCancelledOrderStatus(o.status);
        default:
          return true;
      }
    });
  }, [orders, orderFilter]);

  const billOrders = useMemo(
    () => orders.filter((o) => !isCancelledOrderStatus(o.status)),
    [orders],
  );

  // Manual Payment Verification Queue: Verification Requested first, then Pending / Not Received
  const paymentVerificationQueue = useMemo(() => {
    return orders
      .filter(
        (o) =>
          !isCancelledOrderStatus(o.status) &&
          o.status !== 'pending' &&
          o.payment_status !== 'paid',
      )
      .sort((a, b) => {
        const aReq = a.payment_status === 'verification_requested' ? 0 : 1;
        const bReq = b.payment_status === 'verification_requested' ? 0 : 1;
        if (aReq !== bReq) return aReq - bReq;
        return timestampToDate(b.created_at).getTime() - timestampToDate(a.created_at).getTime();
      });
  }, [orders]);

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
    <>
    <div className="min-h-screen bg-[#F8F9FA] text-neutral-900 flex flex-col lg:flex-row print:hidden">
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
        {/* Clean Sticky Header with Back Button on Sub-Pages */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-neutral-200 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {(section !== 'dashboard' || selectedTableNum !== null) && (
              <button
                type="button"
                onClick={handleAdminBack}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-900 text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{selectedTableNum !== null ? 'Back' : 'Back'}</span>
              </button>
            )}
            <span className="lg:hidden font-display text-base sm:text-lg font-extrabold tracking-tight text-neutral-900 whitespace-nowrap truncate">
              {section === 'dashboard' ? (
                <>
                  RikZen <span className="text-[#E5391B]">Fast Food</span>
                </>
              ) : section === 'menu' ? (
                'Menu'
              ) : section === 'offers' ? (
                'Offers'
              ) : section === 'tables' ? (
                'Tables'
              ) : section === 'bills' ? (
                'Bills & Payments'
              ) : section === 'reports' ? (
                'Sales & History'
              ) : (
                'Settings'
              )}
            </span>
            <h1 className="hidden lg:block text-xl font-extrabold text-neutral-900 truncate">
              {section === 'dashboard' && 'Live Orders'}
              {section === 'menu' && 'Menu Management'}
              {section === 'offers' && 'Offers'}
              {section === 'tables' && 'Tables & QR Codes'}
              {section === 'bills' && 'Customer Bills & Payment Verification'}
              {section === 'reports' && 'Sales Reports & Order History'}
              {section === 'settings' && 'Shop Settings & System Diagnostics'}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {voiceQueueState.isSpeaking && (
              <button
                type="button"
                onClick={() => voiceOrderAlertManager.skipCurrent()}
                title="Stop current announcement"
                className="min-h-[40px] px-3 rounded-xl bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
                <span className="hidden md:inline max-w-[140px] truncate">
                  {voiceQueueState.currentLabel || 'Announcing...'}
                </span>
                <Square className="w-3 h-3 fill-current" />
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleVoiceEnabled}
              aria-label={voiceSettings.enabled ? 'Turn voice alerts off' : 'Turn voice alerts on'}
              className={`min-h-[40px] min-w-[40px] px-3 rounded-xl border inline-flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer ${
                voiceSettings.enabled
                  ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-50'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {voiceSettings.enabled ? (
                <Volume2 className="w-4 h-4 text-emerald-700" />
              ) : (
                <VolumeX className="w-4 h-4 text-neutral-400" />
              )}
              <span className="hidden sm:inline">
                {voiceSettings.enabled ? 'Voice ON' : 'Voice OFF'}
              </span>
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

        {/* Browser Autoplay Requirement Banner: Enable Order Alerts */}
        {voiceSettings.enabled && (!voiceSettings.soundActivated || !voiceQueueState.audioUnlocked) && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#E5391B] text-white flex items-center justify-center shrink-0">
                  <Volume2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-neutral-900">
                    Enable Order Alerts
                  </p>
                  <p className="text-xs text-neutral-700">
                    Click once to activate natural Indian female voice announcements for incoming table orders.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnableSoundAlerts}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-[#E5391B] hover:bg-[#C82E14] text-white text-xs font-extrabold tracking-wide inline-flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <Volume2 className="w-4 h-4" />
                  ENABLE SOUND
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clear Fallback Notice if Speech Synthesis or Browser Audio Fails */}
        {voiceQueueState.lastError && voiceQueueState.lastError !== dismissedVoiceError && (
          <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-2.5">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="font-semibold text-red-800">{voiceQueueState.lastError}</p>
              <div className="flex items-center gap-2">
                {!voiceQueueState.audioUnlocked && (
                  <button
                    type="button"
                    onClick={handleEnableSoundAlerts}
                    className="px-3 py-1 rounded-lg bg-[#E5391B] text-white font-bold cursor-pointer"
                  >
                    ENABLE SOUND
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDismissedVoiceError(voiceQueueState.lastError)}
                  className="px-2.5 py-1 rounded-lg border border-red-200 text-red-800 font-semibold hover:bg-red-100 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Large Animated Visual New Order Alert Card (Confirm / Reject Directly) */}
        <AnimatePresence>
          {liveAlertOrders.length > 0 && (() => {
            const activeAlert = liveAlertOrders[0];
            const isSpeakingThis = voiceQueueState.currentOrderId === activeAlert.id;
            const isAlertBusy = busyOrderId === activeAlert.id;
            const remainingAlerts = liveAlertOrders.length - 1;
            return (
              <motion.div
                key={activeAlert.id}
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.96 }}
                transition={{ duration: 0.24 }}
                className="fixed top-20 right-4 z-50 w-[calc(100vw-2rem)] max-w-md rounded-3xl bg-[#151110] text-white border-2 border-[#E5391B] shadow-2xl shadow-red-600/30 p-5 space-y-4"
              >
                {/* Subtle pulsing top glow ring */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-amber-300">
                        <Bell className="w-4 h-4 text-[#E5391B] animate-bounce" />
                        NEW ORDER
                      </span>
                      {isSpeakingThis && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                          <Mic className="w-3 h-3 animate-pulse" />
                          Announcing...
                        </span>
                      )}
                      {remainingAlerts > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-white/10 text-amber-200">
                          +{remainingAlerts} more
                        </span>
                      )}
                    </div>
                    <h3 className="font-display text-2xl font-extrabold tracking-tight text-white">
                      TABLE {activeAlert.table_number}
                    </h3>
                    <p className="text-sm font-bold text-neutral-200">
                      {activeAlert.customer_name || 'Guest'}
                      <span className="font-mono text-xs text-neutral-400 ml-2">
                        #{activeAlert.order_code}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setLiveAlertOrders((prev) => prev.filter((o) => o.id !== activeAlert.id))
                      }
                      aria-label="Dismiss new order alert"
                      className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <p className="font-mono text-2xl font-extrabold text-amber-300 tabular-nums">
                      {formatRupees(activeAlert.total)}
                    </p>
                  </div>
                </div>

                {/* Every ordered item clearly visible */}
                <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-1.5 max-h-40 overflow-y-auto">
                  {activeAlert.items.map((line) => (
                    <div
                      key={line.menu_item_id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="font-semibold text-white">
                        {line.name} × {line.quantity}
                      </span>
                      <span className="font-mono text-xs text-neutral-300 tabular-nums">
                        {formatRupees(line.line_total)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Direct Confirm & Cancel Actions */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={isAlertBusy}
                    onClick={async () => {
                      const ok = await handleStatusChange(activeAlert, 'accepted');
                      if (ok) {
                        setLiveAlertOrders((prev) => prev.filter((o) => o.id !== activeAlert.id));
                      }
                    }}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" />
                    {isAlertBusy ? 'Confirming...' : 'CONFIRM ORDER'}
                  </button>
                  <button
                    type="button"
                    disabled={isAlertBusy}
                    onClick={() => setCancelModalOrder(activeAlert)}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/35 border border-red-500/40 text-red-200 text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <XCircle className="w-4 h-4" />
                    CANCEL
                  </button>
                </div>
              </motion.div>
            );
          })()}
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
          {dataError && (() => {
            const diag = parseOwnerDiagnosticError(dataError);
            return (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-extrabold text-red-900">
                        Owner Diagnostic Panel · {diag.status}
                      </p>
                      <p className="text-xs text-red-800 mt-0.5">{diag.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={retryingDiagnostic}
                      onClick={handleDiagnosticRetry}
                      className="min-h-[34px] px-3 py-1 rounded-xl bg-red-700 text-white text-xs font-bold hover:bg-red-800 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${retryingDiagnostic ? 'animate-spin' : ''}`} />
                      {retryingDiagnostic ? 'Retrying...' : 'Retry'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        lastFailedActionRef.current = null;
                        setDataError(null);
                      }}
                      className="min-h-[34px] px-2.5 py-1 rounded-xl border border-red-200 bg-white text-red-800 text-xs font-semibold hover:bg-red-100 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-white/80 border border-red-200/70 px-3 py-2">
                    <span className="font-bold text-red-700 block">Operation</span>
                    <span className="font-mono font-semibold text-neutral-900">{diag.operation}</span>
                  </div>
                  <div className="rounded-xl bg-white/80 border border-red-200/70 px-3 py-2">
                    <span className="font-bold text-red-700 block">Collection / Path</span>
                    <span className="font-mono font-semibold text-neutral-900 break-all">{diag.path}</span>
                  </div>
                  <div className="rounded-xl bg-white/80 border border-red-200/70 px-3 py-2">
                    <span className="font-bold text-red-700 block">Suggested Fix</span>
                    <span className="text-neutral-800">{diag.suggestedFix}</span>
                  </div>
                </div>
              </div>
            );
          })()}

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

              {/* 4 Animated Top KPI Cards (Today's Sales, Orders, Paid, Pending) */}
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
                    {stats.todaysCompletedCount} completed · Avg {formatRupees(stats.avgOrderValue)}
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => setSection('tables')}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 cursor-pointer hover:border-neutral-300"
                >
                  <p className="text-xs font-bold text-neutral-500">Today&apos;s Orders</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-neutral-900 mt-1">
                    <AnimatedNumber value={stats.todaysOrders} />
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium mt-1 tabular-nums">
                    Active Tables: {stats.activeTablesCount} / 6
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => setSection('bills')}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 cursor-pointer hover:border-neutral-300"
                >
                  <p className="text-xs font-bold text-neutral-500">Paid Today</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-1">
                    <AnimatedNumber value={stats.todaysPaidCount} />
                  </p>
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    Verified payments received
                  </p>
                </motion.div>

                <motion.div
                  whileHover={prefersReducedMotion ? undefined : { y: -2 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => setSection('bills')}
                  className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 cursor-pointer hover:border-neutral-300"
                >
                  <p className="text-xs font-bold text-neutral-500">Pending Payment</p>
                  <p className="font-mono text-2xl sm:text-3xl font-extrabold text-amber-700 mt-1">
                    <AnimatedNumber value={stats.todaysPendingPaymentCount} />
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium mt-1 tabular-nums">
                    Awaiting customer UPI / cash
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

              {/* Live Voice Order Alert Control Bar */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                      voiceSettings.enabled
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-neutral-100 text-neutral-500 border border-neutral-200'
                    }`}
                  >
                    {voiceSettings.enabled ? (
                      <Mic className={`w-5 h-5 ${voiceQueueState.isSpeaking ? 'animate-pulse' : ''}`} />
                    ) : (
                      <VolumeX className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-extrabold text-neutral-900">
                        Live Voice Order Alerts · Indian Female
                      </h3>
                      {voiceQueueState.isSpeaking && (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                          Speaking {voiceQueueState.currentLabel || ''}
                          {voiceQueueState.queueLength > 0
                            ? ` (+${voiceQueueState.queueLength} queued)`
                            : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Announces table number, customer name, every ordered item, and verified total in sequence.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Voice ON / OFF */}
                  <button
                    type="button"
                    onClick={handleToggleVoiceEnabled}
                    className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer border ${
                      voiceSettings.enabled
                        ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-neutral-100 border-neutral-200 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {voiceSettings.enabled ? (
                      <Volume2 className="w-4 h-4" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                    {voiceSettings.enabled ? 'Voice ON' : 'Voice OFF'}
                  </button>

                  {/* Volume Slider */}
                  <label className="inline-flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 min-h-[40px]">
                    <span className="text-[11px] font-bold text-neutral-600 whitespace-nowrap">
                      Vol {voiceSettings.volume}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={voiceSettings.volume}
                      onChange={(e) => handleChangeVoiceVolume(Number(e.target.value))}
                      aria-label="Voice alert volume"
                      className="w-20 accent-[#E5391B] cursor-pointer"
                    />
                  </label>

                  {/* Test Order Announcement Button */}
                  <button
                    type="button"
                    onClick={handleTestVoiceAnnouncement}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Volume2 className="w-4 h-4 text-amber-300" />
                    TEST ORDER ANNOUNCEMENT
                  </button>
                </div>
              </div>

              {/* Manual Payment Verification Queue (Shows customer "I HAVE PAID" alerts & unpaid bills) */}
              {paymentVerificationQueue.length > 0 && (() => {
                const verificationRequestedCount = paymentVerificationQueue.filter(
                  (o) => o.payment_status === 'verification_requested',
                ).length;
                return (
                  <section
                    className={`bg-white rounded-3xl border-2 p-5 sm:p-6 space-y-4 ${
                      verificationRequestedCount > 0 ? 'border-amber-400 shadow-sm' : 'border-amber-300'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-extrabold text-neutral-900 inline-flex items-center gap-2">
                          <CreditCard className="w-5 h-5 text-[#E5391B]" />
                          {verificationRequestedCount > 0
                            ? `Payment Verification Required (${verificationRequestedCount} waiting)`
                            : `Payment Verification (${paymentVerificationQueue.length})`}
                        </h3>
                        <p className="text-xs text-neutral-600 mt-0.5">
                          Check your UPI app / cash counter before confirming. Only owner-verified Paid orders count toward sales revenue.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSection('bills')}
                        className="text-xs font-bold text-[#E5391B] hover:underline cursor-pointer"
                      >
                        Open All Bills →
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {paymentVerificationQueue.slice(0, 6).map((ord) => {
                        const isRequested = ord.payment_status === 'verification_requested';
                        const isNotReceived = ord.payment_status === 'not_received';
                        const isBusyPay = updatingPaymentId === ord.id;
                        const requestTimeLabel = ord.payment_requested_at
                          ? `${formatOrderDate(ord.payment_requested_at)} (${formatRelativeTime(ord.payment_requested_at, nowMs)})`
                          : null;

                        return (
                          <div
                            key={ord.id}
                            className={`rounded-2xl border p-4 space-y-3 ${
                              isRequested
                                ? 'border-amber-400 bg-amber-50/75'
                                : isNotReceived
                                  ? 'border-red-200 bg-red-50/40'
                                  : 'border-neutral-200 bg-neutral-50/60'
                            }`}
                          >
                            {/* 1-4 & 6-7: Order ID, Table, Customer Name, Mobile, Total Amount, Payment Status */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-mono font-extrabold text-[#E5391B]">
                                  #{ord.order_code} · Table {ord.table_number}
                                </p>
                                <p className="text-sm font-extrabold text-neutral-900 truncate">
                                  {ord.customer_name}
                                </p>
                                <p className="text-xs font-mono text-neutral-600">
                                  {formatIndianMobileDisplay(ord.customer_mobile)}
                                </p>
                              </div>
                              <div className="text-right shrink-0 tabular-nums">
                                <p className="font-mono text-xl font-extrabold text-neutral-900">
                                  {formatRupees(ord.total)}
                                </p>
                                <span
                                  className={`inline-flex items-center gap-1 text-[11px] font-extrabold ${
                                    isRequested
                                      ? 'text-amber-800'
                                      : isNotReceived
                                        ? 'text-red-700'
                                        : 'text-neutral-600'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      isRequested
                                        ? 'bg-amber-500 animate-ping'
                                        : isNotReceived
                                          ? 'bg-red-600'
                                          : 'bg-amber-500'
                                    }`}
                                  />
                                  {isRequested
                                    ? 'Verification Requested'
                                    : isNotReceived
                                      ? 'Payment Not Received'
                                      : 'Payment Pending'}
                                </span>
                              </div>
                            </div>

                            {/* 5: Ordered Items */}
                            <div className="rounded-xl bg-white/85 border border-neutral-200/80 px-3 py-2 text-xs text-neutral-800 space-y-1">
                              <p className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                                Ordered Items ({ord.items.reduce((sum, i) => sum + i.quantity, 0)})
                              </p>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                {ord.items.map((item) => (
                                  <span key={item.menu_item_id} className="font-semibold">
                                    {item.quantity}× {item.name}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* 8: Payment Request Time */}
                            {requestTimeLabel && (
                              <p className="text-[11px] font-semibold text-amber-900">
                                Requested at: <span className="font-mono">{requestTimeLabel}</span>
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setPreviewBillOrder(ord)}
                                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-800 text-xs font-bold hover:bg-neutral-100 inline-flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                VIEW BILL
                              </button>
                              <button
                                type="button"
                                disabled={isBusyPay}
                                onClick={() => handleMarkPaid(ord)}
                                className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {isBusyPay ? 'Updating...' : '✓ PAYMENT RECEIVED'}
                              </button>
                              <button
                                type="button"
                                disabled={isBusyPay}
                                onClick={() => handleMarkPaymentNotReceived(ord)}
                                className="min-h-[38px] px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                ✕ PAYMENT NOT RECEIVED
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })()}

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
                      const isSharing = sharingBillId === order.id;
                      const isCancelled = isCancelledOrderStatus(order.status);
                      const isConfirmedStage = order.status !== 'pending' && !isCancelled;
                      const isBeingAnnounced = voiceQueueState.currentOrderId === order.id;
                      const canCancelThis = canCancelOrderStatus(order.status);

                      return (
                        <motion.article
                          key={order.id}
                          layout
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ duration: 0.22 }}
                          className={`bg-white rounded-3xl border p-5 sm:p-6 flex flex-col justify-between gap-4 transition-shadow ${
                            order.status === 'pending'
                              ? isBeingAnnounced
                                ? 'border-[#E5391B] ring-4 ring-[#E5391B]/20 shadow-lg shadow-red-500/15'
                                : 'border-red-300 ring-2 ring-red-500/15 shadow-md shadow-red-500/10'
                              : isCancelled
                                ? 'border-red-200 bg-red-50/20'
                                : order.status === 'bill_requested'
                                  ? 'border-amber-300 shadow-sm shadow-amber-500/10'
                                  : 'border-neutral-200'
                          }`}
                        >
                          <div className="space-y-4">
                            {/* Header Row: Status + Customer Name + Mobile + Table + Order # */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p
                                    className={`text-xs font-extrabold tracking-wide inline-flex items-center gap-1.5 ${
                                      order.status === 'pending'
                                        ? 'text-red-700'
                                        : isCancelled
                                          ? 'text-red-700'
                                          : order.status === 'bill_requested'
                                            ? 'text-amber-800'
                                            : order.status === 'preparing'
                                              ? 'text-amber-700'
                                              : 'text-emerald-700'
                                    }`}
                                  >
                                    {order.status === 'pending' && (
                                      <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                                    )}
                                    {isCancelled && (
                                      <span className="w-2 h-2 rounded-full bg-red-600" />
                                    )}
                                    {order.status === 'pending'
                                      ? 'NEW ORDER'
                                      : isCancelled
                                        ? 'CANCELLED'
                                        : order.status === 'accepted' || order.status === 'confirmed'
                                          ? 'CONFIRMED'
                                          : order.status === 'bill_requested'
                                            ? 'BILL REQUESTED'
                                            : order.status.replace('_', ' ').toUpperCase()}
                                  </p>
                                  {order.status === 'pending' && (
                                    <button
                                      type="button"
                                      onClick={() => handleReplayOrderVoice(order)}
                                      className="text-[11px] font-bold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-2 py-0.5 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                                      title="Replay voice announcement"
                                    >
                                      <Volume2 className="w-3 h-3 text-[#E5391B]" />
                                      {isBeingAnnounced ? 'Speaking...' : 'Announce'}
                                    </button>
                                  )}
                                </div>
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

                            {/* Cancelled Order Audit Info */}
                            {isCancelled && (
                              <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs space-y-1">
                                <p className="font-extrabold text-red-800">
                                  Cancelled by Owner
                                  {order.cancelled_at
                                    ? ` · ${formatOrderDate(order.cancelled_at).time}`
                                    : ''}
                                </p>
                                {order.payment_status === 'paid' && (
                                  <p className="font-semibold text-red-700">
                                    Note: Payment was previously marked Paid — handle refund manually at the counter if needed.
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Website-Native Bill, Share & Separate Manual Payment Strip */}
                            {isConfirmedStage && (() => {
                              const billMeta = getBillStatusMeta(order);
                              const cardBillErr = billErrors[order.id];

                              return (
                                <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-3.5 space-y-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span className="font-bold text-neutral-800 inline-flex items-center gap-1.5">
                                      <FileText className="w-3.5 h-3.5 text-[#E5391B]" />
                                      <span
                                        className={
                                          order.payment_status === 'paid'
                                            ? 'text-emerald-700'
                                            : order.payment_status === 'not_received'
                                              ? 'text-red-700'
                                              : 'text-amber-800'
                                        }
                                      >
                                        {order.payment_status === 'paid'
                                          ? 'Payment: Paid'
                                          : order.payment_status === 'verification_requested'
                                            ? 'Payment: Verification Pending'
                                            : order.payment_status === 'not_received'
                                              ? 'Payment: Not Received'
                                              : 'Payment: Pending'}
                                      </span>
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

                                  <div className="grid grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewBillOrder(order)}
                                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-900 text-xs font-bold hover:bg-neutral-100 inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      View Bill
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
                                      disabled={isSharing}
                                      onClick={() => handleShareBill(order)}
                                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                                    >
                                      {isSharing ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Share2 className="w-3.5 h-3.5" />
                                      )}
                                      {isSharing ? 'Sharing...' : 'Share Bill'}
                                    </button>
                                  </div>

                                  {order.payment_status !== 'paid' && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        type="button"
                                        disabled={updatingPaymentId === order.id}
                                        onClick={() => handleMarkPaid(order)}
                                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-extrabold hover:bg-emerald-100 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {updatingPaymentId === order.id ? 'Updating...' : 'Payment Received'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={updatingPaymentId === order.id}
                                        onClick={() => handleMarkPaymentNotReceived(order)}
                                        className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                        Not Received
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Primary One-Way POS Lifecycle Buttons (Cancel allowed ONLY before READY) */}
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
                                  {isBusy ? 'Confirming...' : 'CONFIRM'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setCancelModalOrder(order)}
                                  className="min-h-[50px] px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                >
                                  <XCircle className="w-5 h-5" />
                                  CANCEL
                                </button>
                              </>
                            )}

                            {(order.status === 'accepted' || order.status === 'confirmed') && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(order, 'preparing')}
                                  className="flex-1 min-h-[50px] px-4 py-3 rounded-xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                                >
                                  <ChefHat className="w-5 h-5" />
                                  START PREPARING
                                </button>
                                {canCancelThis && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => setCancelModalOrder(order)}
                                    className="min-h-[50px] px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                  >
                                    <XCircle className="w-4 h-4" />
                                    CANCEL
                                  </button>
                                )}
                              </>
                            )}

                            {order.status === 'preparing' && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStatusChange(order, 'ready')}
                                  className="flex-1 min-h-[50px] px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                                >
                                  <Utensils className="w-5 h-5" />
                                  MARK READY
                                </button>
                                {canCancelThis && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => setCancelModalOrder(order)}
                                    className="min-h-[50px] px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                  >
                                    <XCircle className="w-4 h-4" />
                                    CANCEL
                                  </button>
                                )}
                              </>
                            )}

                            {(order.status === 'ready' ||
                              order.status === 'bill_requested' ||
                              order.status === 'bill_ready') && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleStatusChange(order, 'completed')}
                                className="w-full min-h-[50px] px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                              >
                                <Check className="w-5 h-5" />
                                COMPLETE ORDER
                              </button>
                            )}

                            {(order.status === 'completed' || isCancelled) && (
                              <div className="w-full text-center text-xs font-semibold text-neutral-500 py-1.5">
                                {order.status === 'completed'
                                  ? 'Completed & Table Available'
                                  : 'Order Cancelled & Table Available'}
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
              <div className="bg-white rounded-3xl border border-neutral-200 p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-neutral-900">
                    Tables 1–6 Live Status &amp; QR Codes
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Tap any table to inspect orders, or download / print high-resolution Table QR cards.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={downloadingTableQr !== null}
                    onClick={handleDownloadAllTableQrs}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                  >
                    {downloadingTableQr === 'all' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FolderArchive className="w-4 h-4" />
                    )}
                    {downloadingTableQr === 'all' ? 'Creating ZIP...' : 'Download All Table QR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintTableQrs([...TABLE_NUMBERS])}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-4 h-4" />
                    Print All 6 QRs
                  </button>
                </div>
              </div>

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
                            CONFIRM
                          </button>
                        )}
                        {(selectedTableData.activeOrder.status === 'accepted' ||
                          selectedTableData.activeOrder.status === 'confirmed') && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(selectedTableData.activeOrder!, 'preparing')
                            }
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold cursor-pointer"
                          >
                            START PREPARING
                          </button>
                        )}
                        {selectedTableData.activeOrder.status === 'preparing' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(selectedTableData.activeOrder!, 'ready')
                            }
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold cursor-pointer"
                          >
                            MARK READY
                          </button>
                        )}
                        {['ready', 'bill_requested', 'bill_ready'].includes(
                          selectedTableData.activeOrder.status,
                        ) && (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(selectedTableData.activeOrder!, 'completed')
                            }
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold cursor-pointer"
                          >
                            COMPLETE ORDER
                          </button>
                        )}
                        {canCancelOrderStatus(selectedTableData.activeOrder.status) && (
                          <button
                            type="button"
                            onClick={() => setCancelModalOrder(selectedTableData.activeOrder)}
                            className="min-h-[44px] px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-bold cursor-pointer"
                          >
                            CANCEL
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
          {/* SECTION 5: WEBSITE-NATIVE CUSTOMER BILLS & SHARING         */}
          {/* ========================================================== */}
          {section === 'bills' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold text-neutral-900">
                    Customer Bills &amp; Sharing
                  </h2>
                  <p className="text-sm text-neutral-500">
                    View, download, or share direct website PDF bills with payment QR — zero login
                    needed for customers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('settings')}
                  className="text-xs font-bold px-3.5 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <QrCode className="w-4 h-4 text-[#E5391B]" />
                  Payment QR Settings
                </button>
              </div>

              {billOrders.length === 0 ? (
                <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center">
                  <p className="text-base font-bold text-neutral-900 mb-1">No bills generated yet</p>
                  <p className="text-sm text-neutral-500">
                    Confirmed customer orders automatically generate branded PDF bills and shareable
                    links here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {billOrders.map((order) => {
                    const billMeta = getBillStatusMeta(order);
                    const isSharingThis = sharingBillId === order.id;
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
                              className={`text-xs font-extrabold mt-0.5 inline-flex items-center gap-1 justify-end ${
                                order.payment_status === 'paid'
                                  ? 'text-emerald-700'
                                  : order.payment_status === 'not_received'
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  order.payment_status === 'paid'
                                    ? 'bg-emerald-600'
                                    : order.payment_status === 'not_received'
                                      ? 'bg-red-600'
                                      : 'bg-amber-500 animate-pulse'
                                }`}
                              />
                              {order.payment_status === 'paid'
                                ? 'Payment Received'
                                : order.payment_status === 'verification_requested'
                                  ? 'Verification Pending'
                                  : order.payment_status === 'not_received'
                                    ? 'Not Received'
                                    : 'Payment Pending'}
                            </p>
                            <p
                              className={`text-[11px] font-bold mt-0.5 inline-flex items-center gap-1 justify-end ${billMeta.color}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${billMeta.dot}`} />
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

                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewBillOrder(order)}
                            className="min-h-[42px] px-3 py-2 rounded-xl border border-neutral-200 text-neutral-900 text-xs font-bold hover:bg-neutral-50 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View Bill
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
                            disabled={isSharingThis}
                            onClick={() => handleShareBill(order)}
                            className="min-h-[42px] px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                          >
                            {isSharingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Share2 className="w-3.5 h-3.5" />
                            )}
                            {isSharingThis ? 'Sharing...' : 'Share Bill'}
                          </button>
                        </div>

                        {order.payment_status !== 'paid' && (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={updatingPaymentId === order.id}
                              onClick={() => handleMarkPaid(order)}
                              className="min-h-[40px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-extrabold hover:bg-emerald-100 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              {updatingPaymentId === order.id ? 'Updating...' : 'Payment Received'}
                            </button>
                            <button
                              type="button"
                              disabled={updatingPaymentId === order.id}
                              onClick={() => handleMarkPaymentNotReceived(order)}
                              className="min-h-[40px] px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                            >
                              <XCircle className="w-4 h-4" />
                              Not Received
                            </button>
                          </div>
                        )}
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
              onShareBill={handleShareBill}
              onMarkPaid={handleMarkPaid}
              onMarkNotReceived={handleMarkPaymentNotReceived}
              downloadingBillId={downloadingBillId}
              sharingBillId={sharingBillId}
              updatingPaymentId={updatingPaymentId}
              onToast={showToast}
            />
          )}

          {/* ========================================================== */}
          {/* SECTION 7: VOICE ALERTS, PAYMENT QR & TABLE QR CODES     */}
          {/* ========================================================== */}
          {section === 'settings' && (
            <div className="space-y-6">
              {/* 0. Voice Order Alert Settings (Natural Indian Female Voice) */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900 inline-flex items-center gap-2">
                      <Mic className="w-5 h-5 text-[#E5391B]" />
                      Voice Order Alert Settings
                    </h2>
                    <p className="text-sm text-neutral-600 mt-0.5">
                      Real-time natural Indian female voice announcements for every incoming table order
                      (automatically queued when multiple orders arrive together).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleVoiceEnabled}
                    className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer border ${
                      voiceSettings.enabled
                        ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {voiceSettings.enabled ? (
                      <Volume2 className="w-4 h-4" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                    {voiceSettings.enabled ? 'Voice Alerts ON' : 'Voice Alerts OFF'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Language Selection */}
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-2.5">
                    <p className="text-xs font-bold text-neutral-500">Announcement Language</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['en', 'hi', 'both'] as const).map((lng) => {
                        const active = (voiceSettings.language || 'both') === lng;
                        return (
                          <button
                            key={lng}
                            type="button"
                            onClick={() => handleChangeVoiceLanguage(lng)}
                            className={`min-h-[38px] rounded-xl text-xs font-extrabold uppercase cursor-pointer border transition-colors ${
                              active
                                ? 'bg-[#E5391B] border-[#E5391B] text-white'
                                : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                            }`}
                          >
                            {lng === 'en' ? 'EN' : lng === 'hi' ? 'हिंदी' : 'Both'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-neutral-500">Speaks in English, Hindi, or Both.</p>
                  </div>

                  {/* Voice Selection */}
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-1.5">
                    <p className="text-xs font-bold text-neutral-500">Voice</p>
                    <p className="text-sm font-extrabold text-neutral-900">Indian Female</p>
                    <p className="text-[11px] text-neutral-600 leading-relaxed">
                      Natural polite Indian staff voice. Customer mobile numbers are never spoken aloud.
                    </p>
                  </div>

                  {/* Speed Selection */}
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-2.5">
                    <p className="text-xs font-bold text-neutral-500">Speech Speed</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['slow', 'normal', 'fast'] as const).map((spd) => {
                        const active = voiceSettings.speed === spd;
                        return (
                          <button
                            key={spd}
                            type="button"
                            onClick={() => handleChangeVoiceSpeed(spd)}
                            className={`min-h-[38px] rounded-xl text-xs font-extrabold capitalize cursor-pointer border transition-colors ${
                              active
                                ? 'bg-[#E5391B] border-[#E5391B] text-white'
                                : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                            }`}
                          >
                            {spd}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-neutral-500">Default: Normal (0.95× pace)</p>
                  </div>

                  {/* Volume Control */}
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-neutral-500">Volume</span>
                      <span className="font-mono font-extrabold text-neutral-900">
                        {voiceSettings.volume}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={voiceSettings.volume}
                      onChange={(e) => handleChangeVoiceVolume(Number(e.target.value))}
                      aria-label="Announcement volume"
                      className="w-full accent-[#E5391B] cursor-pointer"
                    />
                    <p className="text-[11px] text-neutral-500">Default: 100% (Bell + Voice)</p>
                  </div>
                </div>

                {!voiceQueueState.browserSpeechSupported && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 text-xs font-semibold text-amber-900">
                    Browser Speech Synthesis is not available on this device. Natural server voice
                    audio will be used automatically when online; visual order alerts and bell chimes
                    remain active.
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestVoiceAnnouncement}
                      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4 text-amber-300" />
                      TEST ORDER ANNOUNCEMENT
                    </button>
                    {voiceQueueState.isSpeaking && (
                      <button
                        type="button"
                        onClick={() => voiceOrderAlertManager.stopAndClearQueue()}
                        className="min-h-[44px] px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        Stop Speaking
                      </button>
                    )}
                    {!voiceQueueState.audioUnlocked && (
                      <button
                        type="button"
                        onClick={handleEnableSoundAlerts}
                        className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#E5391B] hover:bg-[#C82E14] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Volume2 className="w-4 h-4" />
                        ENABLE SOUND
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 font-medium">
                    Sample: &ldquo;Test announcement. New order received from Table number 3…&rdquo;
                  </p>
                </div>
              </div>

              {/* 1. Honest 2-Mode Restaurant Payment QR Settings */}
              <form
                onSubmit={handleSavePaymentSettings}
                className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900 inline-flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#E5391B]" />
                      Payment QR Settings
                    </h2>
                    <p className="text-sm text-neutral-600 mt-0.5">
                      Choose how customers pay on their bill: display your exact uploaded restaurant
                      QR image or generate a dynamic exact-amount UPI QR.
                    </p>
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1.5 rounded-xl border inline-flex items-center gap-1.5 ${
                      (paymentSettings.payment_mode === 'uploaded_qr' &&
                        Boolean(paymentSettings.qr_image_url)) ||
                      (paymentSettings.payment_mode === 'dynamic_upi' &&
                        Boolean(paymentSettings.upi_id))
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        (paymentSettings.payment_mode === 'uploaded_qr' &&
                          Boolean(paymentSettings.qr_image_url)) ||
                        (paymentSettings.payment_mode === 'dynamic_upi' &&
                          Boolean(paymentSettings.upi_id))
                          ? 'bg-emerald-600'
                          : 'bg-amber-500'
                      }`}
                    />
                    {paymentSettings.payment_mode === 'uploaded_qr'
                      ? paymentSettings.qr_image_url
                        ? 'Mode 1 · Uploaded QR Active'
                        : 'Upload QR Needed'
                      : paymentSettings.upi_id
                        ? `Mode 2 · Dynamic UPI (${paymentSettings.upi_id})`
                        : 'UPI Setup Needed'}
                  </span>
                </div>

                {/* Honest 2-Mode Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      paymentDraftDirtyRef.current = true;
                      setPaymentDraft((prev) => ({ ...prev, payment_mode: 'uploaded_qr' }));
                    }}
                    className={`text-left rounded-2xl border p-4 transition-colors cursor-pointer ${
                      paymentDraft.payment_mode === 'uploaded_qr'
                        ? 'border-[#E5391B] bg-[#FEF2F0]/60 ring-2 ring-[#E5391B]/15'
                        : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100'
                    }`}
                  >
                    <p className="text-xs font-extrabold text-neutral-900">
                      Mode 1 · Uploaded Payment QR
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
                      Shows your exact un-altered PhonePe / GPay / Paytm / BharatPe QR image on
                      bills. Customers enter the bill amount manually in their UPI app.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      paymentDraftDirtyRef.current = true;
                      setPaymentDraft((prev) => ({ ...prev, payment_mode: 'dynamic_upi' }));
                    }}
                    className={`text-left rounded-2xl border p-4 transition-colors cursor-pointer ${
                      paymentDraft.payment_mode === 'dynamic_upi'
                        ? 'border-[#E5391B] bg-[#FEF2F0]/60 ring-2 ring-[#E5391B]/15'
                        : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100'
                    }`}
                  >
                    <p className="text-xs font-extrabold text-neutral-900">
                      Mode 2 · Dynamic Exact-Amount UPI QR
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
                      Generates a fresh UPI QR for each bill with the exact final total pre-filled
                      automatically using your Restaurant UPI ID.
                    </p>
                  </button>
                </div>

                {qrScanNotice && (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-semibold text-emerald-900">
                    {qrScanNotice}
                  </div>
                )}

                {paymentFormError && (
                  <div className="rounded-2xl bg-red-50 border border-red-200 p-3.5 text-xs font-semibold text-red-800">
                    {paymentFormError}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  <div className="lg:col-span-7 space-y-4">
                    <div>
                      <label
                        htmlFor="owner-merchant-name"
                        className="block text-xs font-bold text-neutral-700 mb-1.5"
                      >
                        Restaurant Name
                      </label>
                      <input
                        id="owner-merchant-name"
                        type="text"
                        required
                        minLength={2}
                        maxLength={80}
                        value={paymentDraft.merchant_name}
                        onChange={(e) => {
                          paymentDraftDirtyRef.current = true;
                          setPaymentDraft((prev) => ({ ...prev, merchant_name: e.target.value }));
                        }}
                        placeholder="RikZen Fast Food"
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-sm text-neutral-900 focus:outline-none focus:bg-white focus:border-[#E5391B]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="owner-upi-id"
                        className="block text-xs font-bold text-neutral-700 mb-1.5"
                      >
                        Restaurant UPI ID{' '}
                        {paymentDraft.payment_mode === 'dynamic_upi' ? '(Required for Mode 2)' : '(Optional)'}
                      </label>
                      <input
                        id="owner-upi-id"
                        type="text"
                        maxLength={120}
                        value={paymentDraft.upi_id}
                        onChange={(e) => {
                          paymentDraftDirtyRef.current = true;
                          setPaymentDraft((prev) => ({ ...prev, upi_id: e.target.value }));
                        }}
                        placeholder="e.g., rikzenfastfood@okaxis or 9876543210@ybl"
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-sm font-mono text-neutral-900 focus:outline-none focus:bg-white focus:border-[#E5391B]"
                      />
                    </div>

                    <div className="space-y-2">
                      <span className="block text-xs font-bold text-neutral-700">
                        Restaurant Payment QR Image (PNG, JPG, JPEG, WEBP · Max 5 MB)
                      </span>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <label className="min-h-[44px] px-4 py-2.5 rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-neutral-900 text-xs font-bold inline-flex items-center gap-2 cursor-pointer">
                          {uploadingQr ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4 text-[#E5391B]" />
                          )}
                          {uploadingQr
                            ? 'Uploading QR...'
                            : paymentDraft.qr_image_url
                              ? 'Replace Payment QR'
                              : 'Upload Restaurant Payment QR'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleUploadPaymentQrFile}
                            disabled={uploadingQr}
                            className="sr-only"
                          />
                        </label>
                        {paymentDraft.qr_image_url && (
                          <button
                            type="button"
                            disabled={deletingQr || savingPayment}
                            onClick={handleDeletePaymentQr}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            {deletingQr ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Delete QR
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        Existing old bills keep their saved payment QR snapshot. New bills will use
                        your latest saved QR.
                      </p>
                    </div>

                    <div className="pt-1 flex flex-wrap gap-2.5">
                      <button
                        type="submit"
                        disabled={savingPayment || uploadingQr}
                        className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#E5391B] text-white text-sm font-bold hover:bg-[#C82E14] active:scale-[0.98] transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        {savingPayment ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {savingPayment ? 'Saving...' : 'Save Payment Settings'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestQrModalOpen(true)}
                        className="min-h-[46px] px-5 py-2.5 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-sm font-bold hover:bg-neutral-50 inline-flex items-center gap-2 cursor-pointer"
                      >
                        <QrCode className="w-4 h-4 text-[#E5391B]" />
                        Test Payment QR
                      </button>
                    </div>
                  </div>

                  {/* Right Preview: Crisp Un-Altered Uploaded QR OR Dynamic Exact-Amount Preview */}
                  <div className="lg:col-span-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-3 text-center">
                    <p className="text-xs font-extrabold text-neutral-700 inline-flex items-center gap-1.5">
                      <QrCode className="w-4 h-4 text-[#E5391B]" />
                      {paymentDraft.payment_mode === 'uploaded_qr'
                        ? 'Uploaded Restaurant QR Preview'
                        : 'Dynamic Bill QR Preview (Sample ₹260)'}
                    </p>
                    {paymentDraft.payment_mode === 'uploaded_qr' ? (
                      paymentDraft.qr_image_url ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="p-2.5 bg-white rounded-xl border border-neutral-900 inline-flex items-center justify-center">
                            <img
                              src={paymentDraft.qr_image_url}
                              alt="Uploaded restaurant payment QR"
                              className="w-44 h-44 object-contain bg-white"
                            />
                          </div>
                          <p className="text-xs font-bold text-neutral-800">
                            Exact original QR (zero cropping or distortion)
                          </p>
                          <p className="text-[11px] text-neutral-600">
                            Customer scans &amp; enters the bill amount in their UPI app.
                          </p>
                        </div>
                      ) : (
                        <div className="py-8 px-4 text-xs text-neutral-500">
                          Upload your restaurant PhonePe / GPay / Paytm QR image to preview it
                          cleanly here.
                        </div>
                      )
                    ) : isValidUpiId(paymentDraft.upi_id) ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="p-2.5 bg-white rounded-xl border border-neutral-900 inline-block">
                          <QRCodeSVG
                            value={buildDynamicUpiUri({
                              upiId: paymentDraft.upi_id,
                              merchantName: paymentDraft.merchant_name || 'RikZen Fast Food',
                              amount: 260,
                              orderCode: 'RK1042',
                              tableNumber: 3,
                            })}
                            size={164}
                            level="H"
                            includeMargin={true}
                            fgColor="#000000"
                            bgColor="#FFFFFF"
                          />
                        </div>
                        <p className="text-xs font-extrabold text-emerald-700">
                          Exact ₹260 pre-filled automatically when scanned
                        </p>
                        <p className="text-[11px] font-mono text-neutral-600 break-all">
                          {paymentDraft.upi_id.trim()}
                        </p>
                      </div>
                    ) : (
                      <div className="py-8 px-4 text-xs text-neutral-500">
                        Enter a valid Restaurant UPI ID on the left to preview your live dynamic
                        exact-amount QR.
                      </div>
                    )}
                  </div>
                </div>
              </form>

              {/* 2. Main Website QR & 6-Table QR Generator, PNG Download, ZIP & Print Center */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900">
                      Main Website QR &amp; Table QRs (Tables 1–6)
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Download print-ready PNGs individually, grab all QRs in one ZIP, or print
                      table tent cards directly.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={downloadingTableQr !== null}
                      onClick={handleDownloadAllTableQrs}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      {downloadingTableQr === 'all' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderArchive className="w-4 h-4" />
                      )}
                      {downloadingTableQr === 'all' ? 'Building ZIP...' : 'Download All (ZIP)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePrintTableQrs(['main', ...TABLE_NUMBERS])}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-4 h-4" />
                      Print All QRs
                    </button>
                  </div>
                </div>

                {/* Featured Main Website QR (/menu) */}
                <div className="rounded-2xl border-2 border-[#E5391B]/30 bg-[#FEF2F0]/40 p-5 flex flex-col sm:flex-row items-center justify-between gap-5">
                  <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
                    <div className="p-2 bg-white rounded-xl border border-neutral-900 shrink-0">
                      <QRCodeSVG
                        value={getMainMenuQrUrl()}
                        size={124}
                        level="H"
                        includeMargin={true}
                        fgColor="#000000"
                        bgColor="#FFFFFF"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-extrabold text-[#E5391B] inline-flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5" />
                        MAIN WEBSITE QR · COUNTER / ENTRANCE
                      </p>
                      <h3 className="text-lg font-extrabold text-neutral-900">
                        RikZen Fast Food Main Menu
                      </h3>
                      <p className="text-xs text-neutral-600 max-w-md">
                        Customers scan to pick their Table (1–6) and order with zero login.
                      </p>
                      <p className="text-xs font-mono text-neutral-500">/menu</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:min-w-[240px]">
                    <button
                      type="button"
                      disabled={downloadingTableQr !== null}
                      onClick={handleDownloadMainMenuQr}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      {downloadingTableQr === 'main' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePrintTableQrs(['main'])}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white border border-neutral-300 text-neutral-900 text-xs font-bold hover:bg-neutral-100 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyMainQrUrl}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-700 text-xs font-semibold hover:bg-neutral-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {copiedTable === 'main' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('/menu')}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-700 text-xs font-semibold hover:bg-neutral-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Test
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {TABLE_NUMBERS.map((num) => {
                    const qrUrl = getTableQrUrl(num);
                    const isDownloadingThis = downloadingTableQr === num;
                    return (
                      <div
                        key={num}
                        className="rounded-2xl border border-neutral-200 p-5 flex flex-col items-center text-center bg-neutral-50/40"
                      >
                        <p className="text-xs font-extrabold text-[#E5391B] tracking-wide">
                          RIKZEN FAST FOOD
                        </p>
                        <h3 className="text-lg font-extrabold text-neutral-900 mb-3">
                          Table {num}
                        </h3>
                        <div className="p-2 bg-white rounded-xl border border-neutral-900 mb-3">
                          <QRCodeSVG
                            value={qrUrl}
                            size={140}
                            level="H"
                            includeMargin={true}
                            fgColor="#000000"
                            bgColor="#FFFFFF"
                          />
                        </div>
                        <p className="text-xs font-mono text-neutral-500 mb-3">/menu?table={num}</p>
                        <div className="w-full grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={downloadingTableQr !== null}
                            onClick={() => handleDownloadSingleTableQr(num)}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                          >
                            {isDownloadingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintTableQrs([num])}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white border border-neutral-300 text-neutral-900 text-xs font-bold hover:bg-neutral-100 inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyQrUrl(num)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            {copiedTable === num ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy Link
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate(`/menu?table=${num}`)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Test
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Owner System Diagnostics & Auth Health Check */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-neutral-900 inline-flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-700" />
                      System Diagnostics
                    </h2>
                    <p className="text-sm text-neutral-600 mt-0.5">
                      Inspect live Firebase authentication, owner role authorization, Firestore read/write readiness, and order signing configuration.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runningDiagnostics}
                    onClick={handleRunSystemTest}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {runningDiagnostics ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-amber-300" />
                    )}
                    {runningDiagnostics ? 'Testing...' : 'RUN SYSTEM TEST'}
                  </button>
                </div>

                {/* Internal Current Firebase User Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3">
                    <span className="text-neutral-500 block font-semibold">Authenticated</span>
                    <span className="font-extrabold text-emerald-700">
                      {user ? 'YES' : 'NO'}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3">
                    <span className="text-neutral-500 block font-semibold">UID</span>
                    <span className="font-mono font-bold text-neutral-900 break-all">
                      {user?.uid || '—'}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3">
                    <span className="text-neutral-500 block font-semibold">Email</span>
                    <span className="font-bold text-neutral-900 break-all">
                      {user?.email || '—'}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3">
                    <span className="text-neutral-500 block font-semibold">Admin / Owner</span>
                    <span className="font-extrabold text-emerald-700">
                      {isOwner ? `YES (${ownerAuthStatus?.source.replace(/_/g, ' ') || 'owner'})` : 'NO'}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-3">
                    <span className="text-neutral-500 block font-semibold">Firebase Project</span>
                    <span className="font-mono font-bold text-neutral-900 break-all">
                      {FIREBASE_PROJECT_ID}
                    </span>
                  </div>
                </div>

                {diagnosticsReport && (
                  <div className="space-y-2 pt-2 border-t border-neutral-100">
                    <p className="text-[11px] font-semibold text-neutral-500">
                      Last checked: {formatOrderDate(diagnosticsReport.checkedAt).date} ·{' '}
                      {formatOrderDate(diagnosticsReport.checkedAt).time} · DB{' '}
                      <span className="font-mono">{FIREBASE_DATABASE_ID}</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {diagnosticsReport.checks.map((chk) => (
                        <div
                          key={chk.id}
                          className={`rounded-2xl border p-3.5 flex items-start gap-2.5 text-xs ${
                            chk.status === 'pass'
                              ? 'bg-emerald-50/60 border-emerald-200'
                              : chk.status === 'warn'
                                ? 'bg-amber-50/70 border-amber-200'
                                : 'bg-red-50/70 border-red-200'
                          }`}
                        >
                          {chk.status === 'pass' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          ) : chk.status === 'warn' ? (
                            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <p className="font-extrabold text-neutral-900">{chk.label}</p>
                            <p className="text-neutral-700 mt-0.5 break-words">{chk.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Clear Order History (Safely deletes ONLY orders, never menu/offers/settings) */}
              <div className="bg-white rounded-3xl border border-red-200 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-extrabold text-red-800 inline-flex items-center gap-2">
                      <Trash2 className="w-5 h-5" />
                      Clear Order History
                    </h2>
                    <p className="text-sm text-neutral-600">
                      Permanently remove all existing / old test orders from Order History &amp; Sales Reports ({orders.length}{' '}
                      {orders.length === 1 ? 'record' : 'records'} currently stored). Future orders will continue saving normally.
                    </p>
                    <p className="text-xs text-neutral-500">
                      Protected &amp; untouched: Menu items, prices, offers, tables, payment QR, admin account, and restaurant settings.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={clearingHistory || orders.length === 0}
                    onClick={() => setClearHistoryModalOpen(true)}
                    className="min-h-[46px] px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                    CLEAR ORDER HISTORY
                  </button>
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
          paymentSettings={paymentSettings}
          onMarkPaid={handleMarkPaid}
          onMarkNotReceived={handleMarkPaymentNotReceived}
          onOpenSettings={() => setSection('settings')}
          isUpdatingPayment={updatingPaymentId === livePreviewOrder.id}
        />
      )}

      {/* Cancel Order Confirmation Modal */}
      {cancelModalOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel order confirmation"
        >
          <div className="bg-white rounded-3xl border border-neutral-200 max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-neutral-900">Cancel this order?</h3>
                <p className="text-xs text-neutral-600 mt-0.5">
                  Customer will be notified immediately on their screen and Table {cancelModalOrder.table_number} will become available.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 space-y-2 text-xs tabular-nums">
              <div className="flex items-center justify-between">
                <span className="font-bold text-neutral-900">{cancelModalOrder.customer_name}</span>
                <span className="font-mono font-extrabold text-[#E5391B]">
                  #{cancelModalOrder.order_code} · Table {cancelModalOrder.table_number}
                </span>
              </div>
              <div className="border-t border-neutral-200 pt-2 space-y-1">
                {cancelModalOrder.items.map((line) => (
                  <div key={line.menu_item_id} className="flex items-center justify-between text-neutral-700">
                    <span>
                      {line.name} × {line.quantity}
                    </span>
                    <span className="font-mono">{formatRupees(line.line_total)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-neutral-200 pt-2 flex items-center justify-between font-extrabold text-sm text-neutral-900">
                <span>Total</span>
                <span className="font-mono">{formatRupees(cancelModalOrder.total)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={cancellingOrder}
                onClick={() => setCancelModalOrder(null)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-800 text-sm font-bold hover:bg-neutral-50 cursor-pointer disabled:opacity-60"
              >
                KEEP ORDER
              </button>
              <button
                type="button"
                disabled={cancellingOrder}
                onClick={handleConfirmCancelOrder}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <XCircle className="w-4 h-4" />
                {cancellingOrder ? 'Cancelling...' : 'CANCEL ORDER'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Order History Confirmation Modal */}
      {clearHistoryModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Clear order history confirmation"
        >
          <div className="bg-white rounded-3xl border border-red-200 max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-neutral-900">
                  Delete all existing order history?
                </h3>
                <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                  This permanently removes {orders.length} existing{' '}
                  {orders.length === 1 ? 'order' : 'orders'} from Order History and Sales Reports.
                  Menu items, prices, offers, tables, payment QR, and settings will NOT be affected.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={clearingHistory}
                onClick={() => setClearHistoryModalOpen(false)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-800 text-sm font-bold hover:bg-neutral-50 cursor-pointer disabled:opacity-60"
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={clearingHistory}
                onClick={handleConfirmClearOrderHistory}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {clearingHistory ? 'Deleting...' : 'DELETE HISTORY'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Payment QR Modal */}
      {testQrModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Test Payment QR Preview"
        >
          <div className="bg-white rounded-3xl border border-neutral-200 max-w-sm w-full p-6 space-y-4 text-center shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-neutral-900">
                Test Payment QR (Sample ₹260)
              </h3>
              <button
                type="button"
                onClick={() => setTestQrModalOpen(false)}
                aria-label="Close test QR modal"
                className="w-9 h-9 rounded-xl border border-neutral-200 flex items-center justify-center text-neutral-600 hover:bg-neutral-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {paymentDraft.payment_mode === 'uploaded_qr' ? (
              paymentDraft.qr_image_url ? (
                <div className="space-y-3">
                  <div className="p-3 bg-white rounded-2xl border-2 border-neutral-900 inline-flex items-center justify-center">
                    <img
                      src={paymentDraft.qr_image_url}
                      alt="Uploaded restaurant payment QR"
                      className="w-56 h-56 object-contain bg-white"
                    />
                  </div>
                  <p className="text-sm font-extrabold text-neutral-900">
                    {paymentDraft.merchant_name || 'RikZen Fast Food'}
                  </p>
                  <p className="text-xs text-neutral-600">
                    Scan with PhonePe / GPay / Paytm and enter{' '}
                    <span className="font-mono font-bold text-neutral-900">₹260</span> to verify
                    this QR works cleanly on customer phones.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  No uploaded payment QR image yet. Upload your QR screenshot first to test it.
                </p>
              )
            ) : isValidUpiId(paymentDraft.upi_id) ? (
              <div className="space-y-3">
                <div className="p-3 bg-white rounded-2xl border-2 border-neutral-900 inline-block">
                  <QRCodeSVG
                    value={buildDynamicUpiUri({
                      upiId: paymentDraft.upi_id,
                      merchantName: paymentDraft.merchant_name || 'RikZen Fast Food',
                      amount: 260,
                      orderCode: 'TEST260',
                      tableNumber: 3,
                    })}
                    size={216}
                    level="H"
                    includeMargin={true}
                    fgColor="#000000"
                    bgColor="#FFFFFF"
                  />
                </div>
                <p className="text-sm font-extrabold text-emerald-700">
                  Exact ₹260 pre-filled automatically
                </p>
                <p className="text-xs font-mono text-neutral-600 break-all">
                  {paymentDraft.upi_id.trim()}
                </p>
              </div>
            ) : (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
                Enter a valid Restaurant UPI ID first to test Dynamic Exact-Amount UPI QR mode.
              </p>
            )}

            <button
              type="button"
              onClick={() => setTestQrModalOpen(false)}
              className="w-full min-h-[44px] rounded-xl bg-neutral-900 text-white text-sm font-bold hover:bg-neutral-800 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Dedicated Print-Only Branded QR Cards Sheet (Main Website QR & Tables 1–6) */}
    <div className="hidden print:block bg-white text-neutral-900 p-4">
      <div
        className={`grid gap-6 ${
          printQrTargets.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'grid-cols-2'
        }`}
      >
        {printQrTargets.map((target) => {
          const isMain = target === 'main';
          const qrValue = isMain ? getMainMenuQrUrl() : getTableQrUrl(target);
          return (
            <div
              key={String(target)}
              className="rikzen-print-break-avoid border-2 border-neutral-900 rounded-3xl p-6 text-center flex flex-col items-center justify-between bg-white"
            >
              <div className="w-full rounded-2xl bg-[#151110] text-white py-3 px-4 mb-4">
                <p className="font-display text-xl font-extrabold tracking-tight">
                  RIKZEN FAST FOOD
                </p>
                <p className="text-[11px] text-amber-200 font-semibold">
                  Fresh · Fast · Delicious
                </p>
              </div>

              <div className="px-6 py-1.5 rounded-xl bg-[#E5391B] text-white font-display text-2xl font-extrabold mb-3">
                {isMain ? 'MAIN MENU' : `TABLE ${target}`}
              </div>

              <p className="text-base font-extrabold text-neutral-900 mb-3">Scan to Order</p>

              <div className="p-3 bg-white border-2 border-neutral-900 rounded-2xl mb-4">
                <QRCodeSVG
                  value={qrValue}
                  size={printQrTargets.length === 1 ? 260 : 200}
                  level="H"
                  includeMargin={true}
                  fgColor="#000000"
                  bgColor="#FFFFFF"
                />
              </div>

              <p className="text-xs font-bold text-emerald-700">
                NO LOGIN REQUIRED · SCAN · ORDER · ENJOY
              </p>
              <p className="text-[11px] font-mono text-neutral-500 mt-1">
                {isMain ? '/menu' : `/menu?table=${target}`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
};
