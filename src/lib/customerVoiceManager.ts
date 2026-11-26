import type { OrderRecord, OrderStatus, PaymentStatus } from '../types/restaurant';

export type CustomerVoiceEventKey =
  | 'order_placed'
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_ready'
  | 'order_completed'
  | 'bill_ready'
  | 'payment_qr_available'
  | 'payment_verification_requested'
  | 'payment_confirmed'
  | 'payment_not_received'
  | 'order_cancelled';

export type CustomerVoiceLanguageMode = 'en' | 'hi' | 'both';

export interface CustomerVoiceState {
  enabled: boolean;
  audioUnlocked: boolean;
  autoplayBlocked: boolean;
  browserSupported: boolean;
  isSpeaking: boolean;
  currentText: string | null;
  currentEventLabel: string | null;
  lastSpokenText: string | null;
  queueLength: number;
  lastError: string | null;
  language: CustomerVoiceLanguageMode;
}

interface CustomerVoiceQueueItem {
  dedupKey: string;
  orderId: string;
  orderCode: string;
  tableNumber: number | null;
  eventKey: CustomerVoiceEventKey;
  eventLabel: string;
  segments: Array<{ text: string; lang: 'en-IN' | 'hi-IN' }>;
  displayText: string;
  louder?: boolean;
}

interface OrderBaselineSnapshot {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  billReady: boolean;
}

const CUSTOMER_VOICE_ENABLED_KEY = 'rikzen_customer_voice_enabled_v1';
const CUSTOMER_VOICE_LANG_KEY = 'rikzen_customer_voice_lang_v1';
const CUSTOMER_ANNOUNCED_KEYS_STORAGE = 'rikzen_customer_voice_announced_events_v2';
const MAX_STORED_ANNOUNCED_KEYS = 250;

const EVENT_LABELS: Record<CustomerVoiceEventKey, string> = {
  order_placed: 'Order Placed',
  order_confirmed: 'Order Confirmed',
  order_preparing: 'Preparing Your Order',
  order_ready: 'Order Ready',
  order_completed: 'Order Completed',
  bill_ready: 'Bill Ready',
  payment_qr_available: 'Payment QR Available',
  payment_verification_requested: 'Payment Verification Pending',
  payment_confirmed: 'Payment Confirmed',
  payment_not_received: 'Payment Not Confirmed',
  order_cancelled: 'Order Cancelled',
};

function formatSpokenOrderNumber(orderCode: string): string {
  const clean = (orderCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const match = clean.match(/^([A-Z]+)(\d+)$/);
  if (!match) return clean || 'your order';
  const letters = match[1].split('').join(' ');
  const digits = match[2];
  return `${letters} ${digits}`;
}

function normalizePronunciationForBrowserSpeech(text: string): string {
  return text
    .replace(/\bFries\b/gi, 'Fryze')
    .replace(/\bQR\b/g, 'Q R')
    .replace(/\bUPI\b/g, 'U P I')
    .replace(/\bRikZen\b/g, 'Rik Zen');
}

function buildCustomerAnnouncementSegments(
  eventKey: CustomerVoiceEventKey,
  orderCode: string,
  tableNumber: number | null,
  language: CustomerVoiceLanguageMode = 'both',
): { segments: Array<{ text: string; lang: 'en-IN' | 'hi-IN' }>; displayText: string; louder?: boolean } {
  const cleanCode = (orderCode || 'RK1000').toUpperCase();
  const spokenCode = formatSpokenOrderNumber(cleanCode);

  let enText = '';
  let hiText = '';
  let louder = false;

  switch (eventKey) {
    case 'order_placed':
      enText = `Your order has been successfully booked. Your order number is ${cleanCode}. Please keep checking your order status.`;
      hiText = `आपका ऑर्डर सफलतापूर्वक बुक हो गया है। आपका ऑर्डर नंबर ${cleanCode} है। कृपया अपने ऑर्डर की स्थिति चेक करते रहें।`;
      break;
    case 'order_confirmed':
      enText = `Good news! Your order number ${cleanCode} has been confirmed by RikZen Fast Food.`;
      hiText = `आपका ऑर्डर स्वीकार कर लिया गया है।`;
      break;
    case 'order_preparing':
      enText = `Your order number ${cleanCode} is now being prepared. Our kitchen team is preparing your food fresh.`;
      hiText = `आपके खाने की तैयारी शुरू हो गई है।`;
      break;
    case 'order_ready':
      louder = true;
      if (tableNumber && tableNumber >= 1 && tableNumber <= 6) {
        enText = `Your order number ${cleanCode} is ready now. Our team will serve your order to Table ${tableNumber}.`;
        hiText = `आपका ऑर्डर तैयार है। टेबल नंबर ${tableNumber} पर सर्व किया जाएगा।`;
      } else {
        enText = `Your order number ${cleanCode} is ready now. Please collect your order from the counter.`;
        hiText = `आपका ऑर्डर तैयार है। कृपया काउंटर से अपना ऑर्डर प्राप्त करें।`;
      }
      break;
    case 'order_completed':
      enText = `Your order has been completed successfully. Thank you for visiting RikZen Fast Food.`;
      hiText = `आपका ऑर्डर पूरा हो गया है। RIKZEN FAST FOOD में आने के लिए धन्यवाद।`;
      break;
    case 'bill_ready':
      enText = `Your bill for order number ${cleanCode} is now ready. Please open your bill to check details.`;
      hiText = `आपका बिल तैयार है। कृपया बिल और भुगतान विवरण देखें।`;
      break;
    case 'payment_qr_available':
      enText = `Your payment QR code is available on your bill. Please scan and pay using UPI, then tap I Have Paid.`;
      hiText = `आपका पेमेंट QR कोड तैयार है। स्कैन करके भुगतान करें और I Have Paid बटन दबाएं।`;
      break;
    case 'payment_verification_requested':
      enText = `Your payment verification request has been sent successfully to RikZen Fast Food. Please wait.`;
      hiText = `आपका पेमेंट वेरिफिकेशन अनुरोध भेज दिया गया है। कृपया पुष्टि की प्रतीक्षा करें।`;
      break;
    case 'payment_confirmed':
      louder = true;
      enText = `Payment received successfully. Your payment for order number ${cleanCode} has been verified and confirmed.`;
      hiText = `भुगतान सफलतापूर्वक प्राप्त हो गया है। आपका बिल पूरी तरह से चुकता हो गया है।`;
      break;
    case 'payment_not_received':
      enText = `We could not confirm your payment for order number ${cleanCode}. Please check your payment details.`;
      hiText = `आपका भुगतान सत्यापित नहीं हो पाया है। कृपया सहायता के लिए संपर्क करें।`;
      break;
    case 'order_cancelled':
      louder = true;
      enText = `Your order number ${cleanCode} has been cancelled by RikZen Fast Food.`;
      hiText = `हमें खेद है। आपका ऑर्डर रद्द कर दिया गया है।`;
      break;
  }

  const segments: Array<{ text: string; lang: 'en-IN' | 'hi-IN' }> = [];
  if (language === 'en' || language === 'both') {
    segments.push({ text: enText, lang: 'en-IN' });
  }
  if (language === 'hi' || language === 'both') {
    segments.push({ text: hiText, lang: 'hi-IN' });
  }

  return {
    segments,
    displayText: language === 'hi' ? hiText : enText,
    louder,
  };
}

function loadLanguagePreference(): CustomerVoiceLanguageMode {
  if (typeof window === 'undefined') return 'both';
  try {
    const raw = window.localStorage.getItem(CUSTOMER_VOICE_LANG_KEY);
    if (raw === 'en' || raw === 'hi' || raw === 'both') return raw;
    return 'both';
  } catch {
    return 'both';
  }
}

function saveLanguagePreference(lang: CustomerVoiceLanguageMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOMER_VOICE_LANG_KEY, lang);
  } catch {
    // Ignore storage errors
  }
}

function loadEnabledPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(CUSTOMER_VOICE_ENABLED_KEY);
    if (raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

function saveEnabledPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOMER_VOICE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

function loadAnnouncedEventKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_ANNOUNCED_KEYS_STORAGE);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((item): item is string => typeof item === 'string' && item.length > 0));
  } catch {
    return new Set();
  }
}

function persistAnnouncedEventKeys(keys: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const list = Array.from(keys);
    const trimmed =
      list.length > MAX_STORED_ANNOUNCED_KEYS
        ? list.slice(list.length - MAX_STORED_ANNOUNCED_KEYS)
        : list;
    window.sessionStorage.setItem(CUSTOMER_ANNOUNCED_KEYS_STORAGE, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}

const INDIAN_FEMALE_VOICE_HINTS = [
  'neerja',
  'heera',
  'veena',
  'raveena',
  'aditi',
  'kajal',
  'priya',
  'kavya',
  'ananya',
  'sangeeta',
  'google english (india)',
  'en-in',
  'india',
];

const MALE_VOICE_EXCLUSIONS = [
  'prabhat',
  'ravi',
  'rishi',
  'hemant',
  'david',
  'mark',
  'daniel',
  'george',
  'james',
  'male',
  'alex',
  'fred',
];

const ENGLISH_FEMALE_HINTS = [
  'samantha',
  'zira',
  'aria',
  'jenny',
  'victoria',
  'karen',
  'moira',
  'tessa',
  'susan',
  'female',
  'google us english',
  'google uk english female',
];

function scoreBrowserVoiceForCustomer(voice: SpeechSynthesisVoice): number {
  const name = (voice.name || '').toLowerCase();
  const lang = (voice.lang || '').toLowerCase();
  const isMale = MALE_VOICE_EXCLUSIONS.some((m) => name.includes(m));
  let score = 0;

  // Priority 1: Natural Indian English female voice
  if (lang.includes('en-in') || lang.includes('en_in')) {
    score += 120;
    if (!isMale) score += 60;
    if (name.includes('natural') || name.includes('neural') || name.includes('online')) score += 45;
    if (INDIAN_FEMALE_VOICE_HINTS.some((h) => name.includes(h))) score += 40;
    if (name.includes('google')) score += 25;
  } else if (INDIAN_FEMALE_VOICE_HINTS.some((h) => name.includes(h)) && lang.startsWith('en')) {
    score += 110;
    if (!isMale) score += 40;
  } else if (lang.startsWith('en')) {
    // Priority 3: High-quality English female voice
    score += 40;
    if (!isMale && ENGLISH_FEMALE_HINTS.some((h) => name.includes(h))) score += 35;
    if (name.includes('natural') || name.includes('neural') || name.includes('google')) score += 20;
  }

  if (isMale) score -= 50;
  if (voice.default && lang.startsWith('en')) score += 5;
  return score;
}

async function resolveBestCustomerBrowserVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const synth = window.speechSynthesis;

  const getRanked = () => {
    const voices = synth.getVoices() || [];
    const english = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
    if (english.length === 0) return voices[0] || null;
    english.sort((a, b) => scoreBrowserVoiceForCustomer(b) - scoreBrowserVoiceForCustomer(a));
    return english[0] || null;
  };

  let existing = synth.getVoices();
  if (existing && existing.length > 0) {
    return getRanked();
  }

  // Properly await voiceschanged on Chrome/Android/Safari when getVoices() starts empty
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 1200);
    synth.addEventListener('voiceschanged', done);
    // Trigger voice loading on mobile Chrome
    synth.getVoices();
  });

  return getRanked();
}

function playGentleCustomerChime(louder = false): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const freqs = louder ? [659.25, 880, 1046.5] : [587.33, 783.99];
    const peakGain = louder ? 0.14 : 0.08;
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.1);
      gain.gain.setValueAtTime(0.001, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + idx * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.25);
    });
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 800);
  } catch {
    // Ignore autoplay errors for chime
  }
}

class CustomerVoiceAnnouncementManager {
  private listeners = new Set<(state: CustomerVoiceState) => void>();
  private queue: CustomerVoiceQueueItem[] = [];
  private blockedPending: CustomerVoiceQueueItem[] = [];
  private announcedKeys: Set<string>;
  private orderBaselines = new Map<string, OrderBaselineSnapshot>();
  private serverTtsUnavailable = false;
  private processing = false;
  private activeAudio: HTMLAudioElement | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private keepAliveTimer: number | null = null;

  private state: CustomerVoiceState;

  constructor() {
    this.announcedKeys = loadAnnouncedEventKeys();
    const supported =
      typeof window !== 'undefined' &&
      ('speechSynthesis' in window || typeof Audio !== 'undefined');
    this.state = {
      enabled: loadEnabledPreference(),
      audioUnlocked: false,
      autoplayBlocked: false,
      browserSupported: supported,
      isSpeaking: false,
      currentText: null,
      currentEventLabel: null,
      lastSpokenText: null,
      queueLength: 0,
      lastError: null,
      language: loadLanguagePreference(),
    };
  }

  public setLanguage(lang: CustomerVoiceLanguageMode): void {
    saveLanguagePreference(lang);
    this.updateState({ language: lang });
  }

  public getLanguage(): CustomerVoiceLanguageMode {
    return this.state.language;
  }

  public async playTestVoice(): Promise<void> {
    await this.unlockOnUserGesture(false);
    const testSegments =
      this.state.language === 'en'
        ? [{ text: 'Test order voice announcement. Your order number is RK1000. Voice is working correctly.', lang: 'en-IN' as const }]
        : this.state.language === 'hi'
        ? [{ text: 'टेस्ट ऑर्डर वॉयस अनाउंसमेंट। आपका ऑर्डर नंबर आर के एक हजार है। आवाज बिल्कुल सही काम कर रही है।', lang: 'hi-IN' as const }]
        : [
            { text: 'Test order voice announcement. Your order number is RK1000.', lang: 'en-IN' as const },
            { text: 'टेस्ट ऑर्डर वॉयस अनाउंसमेंट। आपका ऑर्डर नंबर आर के एक हजार है।', lang: 'hi-IN' as const },
          ];

    this.queue.push({
      dedupKey: `test_${Date.now()}`,
      orderId: 'test_order',
      orderCode: 'RK1000',
      tableNumber: 3,
      eventKey: 'order_confirmed',
      eventLabel: 'Test Voice',
      segments: testSegments,
      displayText: 'Test order voice announcement. Voice is working correctly.',
      louder: true,
    });
    this.updateState({ queueLength: this.queue.length });
    void this.processQueue();
  }

  public getState(): CustomerVoiceState {
    return { ...this.state };
  }

  public subscribe(listener: (state: CustomerVoiceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // Ignore subscriber errors
      }
    });
  }

  private updateState(partial: Partial<CustomerVoiceState>): void {
    this.state = {
      ...this.state,
      ...partial,
      queueLength: this.queue.length,
    };
    this.emit();
  }

  private markAnnounced(dedupKey: string): void {
    this.announcedKeys.add(dedupKey);
    persistAnnouncedEventKeys(this.announcedKeys);
  }

  public hasAnnounced(orderId: string, eventKey: CustomerVoiceEventKey): boolean {
    if (!orderId) return true;
    return this.announcedKeys.has(`${orderId}_${eventKey}`);
  }

  /**
   * Unlocks browser audio & speechSynthesis on a real user click/tap gesture.
   * Safe to call from "Enable Voice Updates", "Place Order", or "Yes, I Paid".
   */
  public async unlockOnUserGesture(announceConfirmation = false): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (
      this.state.audioUnlocked &&
      this.state.enabled &&
      !this.state.autoplayBlocked &&
      !announceConfirmation &&
      this.blockedPending.length === 0
    ) {
      return true;
    }
    try {
      // 1. Unlock WebAudio context silently
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        window.setTimeout(() => {
          void ctx.close().catch(() => {});
        }, 120);
      }

      // 2. Prime speechSynthesis voices on Chrome/Android/iOS Safari
      if ('speechSynthesis' in window) {
        const synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        synth.getVoices();
        if (!announceConfirmation && !synth.speaking && !synth.pending) {
          const silentProbe = new SpeechSynthesisUtterance(' ');
          silentProbe.volume = 0;
          silentProbe.rate = 2;
          try {
            synth.speak(silentProbe);
          } catch {
            // Ignore probe error
          }
        }
      }

      saveEnabledPreference(true);
      this.updateState({
        enabled: true,
        audioUnlocked: true,
        autoplayBlocked: false,
        lastError: null,
      });

      // Replay any announcements that were held while browser autoplay was blocked
      if (this.blockedPending.length > 0) {
        const toPlay = [...this.blockedPending];
        this.blockedPending = [];
        for (const item of toPlay) {
          this.queue.push(item);
        }
        this.updateState({ queueLength: this.queue.length });
        void this.processQueue();
      } else if (announceConfirmation) {
        // Speak a short crisp confirmation so the customer immediately hears that voice works
        this.queue.push({
          dedupKey: `unlock_confirm_${Date.now()}`,
          orderId: 'system',
          orderCode: 'RK1000',
          tableNumber: null,
          eventKey: 'order_confirmed',
          eventLabel: 'Voice Updates Enabled',
          segments: [{ text: 'Order voice updates are now enabled for RikZen Fast Food.', lang: 'en-IN' }],
          displayText: 'Order voice updates are now enabled for RikZen Fast Food.',
        });
        this.updateState({ queueLength: this.queue.length });
        void this.processQueue(true);
      }

      return true;
    } catch (err) {
      console.error('[RikZen Customer Voice Unlock Error]', err);
      this.updateState({
        autoplayBlocked: true,
        lastError: 'Voice temporarily unavailable — Tap to enable voice',
      });
      return false;
    }
  }

  public setEnabled(enabled: boolean): void {
    saveEnabledPreference(enabled);
    if (!enabled) {
      this.stopCurrentAndClearQueue();
    }
    this.updateState({ enabled, lastError: enabled ? null : this.state.lastError });
  }

  public stopCurrentAndClearQueue(): void {
    this.queue = [];
    this.blockedPending = [];
    this.clearKeepAlive();
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        this.activeAudio.currentTime = 0;
      } catch {
        // Ignore
      }
      this.activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    this.activeUtterance = null;
    this.processing = false;
    this.updateState({
      isSpeaking: false,
      currentText: null,
      currentEventLabel: null,
      queueLength: 0,
    });
  }

  /**
   * Explicitly queues a single customer order voice event (deduplicated by orderId + eventKey).
   */
  public announceOrderEvent(params: {
    orderId: string;
    orderCode: string;
    tableNumber?: number | null;
    eventKey: CustomerVoiceEventKey;
    allowRepeatIfNotReceived?: boolean;
  }): void {
    const { orderId, orderCode, tableNumber = null, eventKey, allowRepeatIfNotReceived = false } =
      params;
    if (!orderId || !this.state.enabled) return;

    const dedupKey = allowRepeatIfNotReceived
      ? `${orderId}_${eventKey}_${Date.now()}`
      : `${orderId}_${eventKey}`;

    if (!allowRepeatIfNotReceived && this.announcedKeys.has(dedupKey)) {
      return;
    }
    if (this.queue.some((q) => q.dedupKey === dedupKey)) {
      return;
    }

    const { segments, displayText, louder } = buildCustomerAnnouncementSegments(
      eventKey,
      orderCode,
      tableNumber,
      this.state.language,
    );

    if (!allowRepeatIfNotReceived) {
      this.markAnnounced(dedupKey);
    }

    this.queue.push({
      dedupKey,
      orderId,
      orderCode: (orderCode || 'RK1000').toUpperCase(),
      tableNumber,
      eventKey,
      eventLabel: EVENT_LABELS[eventKey],
      segments,
      displayText,
      louder,
    });

    this.updateState({ queueLength: this.queue.length });
    void this.processQueue();
  }

  /**
   * Synchronizes real-time Firestore `onSnapshot` order updates for the customer's OWN order.
   *
   * - On the FIRST snapshot for a given `order.id` (e.g., after a page refresh or returning via
   *   Find My Order), it records the current state as the baseline and marks already-reached
   *   past stages as seen WITHOUT replaying old announcements!
   * - On every SUBSEQUENT snapshot where status, bill readiness, or paymentStatus actually
   *   changes, it enqueues ONLY the new event(s) sequentially with zero duplicates.
   */
  public syncRealtimeOrderSnapshot(order: OrderRecord): void {
    if (!order?.id) return;
    const orderId = order.id;
    const orderCode = (order.order_code || `RK${order.order_number}`).toUpperCase();
    const payStatus: PaymentStatus = order.paymentStatus || order.payment_status || 'pending';
    const isBillAvailable =
      order.status === 'bill_ready' ||
      order.bill_status === 'generated' ||
      Boolean(order.pdf_ready);

    const prev = this.orderBaselines.get(orderId);

    // First snapshot on mount / page refresh: seed baseline silently so old stages NEVER replay!
    if (!prev) {
      this.orderBaselines.set(orderId, {
        status: order.status,
        paymentStatus: payStatus,
        billReady: isBillAvailable,
      });

      // Mark already-reached lifecycle keys so future snapshots cannot accidentally replay them
      this.markAnnounced(`${orderId}_order_placed`);
      if (
        ['accepted', 'confirmed', 'preparing', 'ready', 'bill_requested', 'bill_ready', 'completed'].includes(
          order.status,
        )
      ) {
        this.markAnnounced(`${orderId}_order_confirmed`);
      }
      if (['preparing', 'ready', 'bill_requested', 'bill_ready', 'completed'].includes(order.status)) {
        this.markAnnounced(`${orderId}_order_preparing`);
      }
      if (['ready', 'bill_requested', 'bill_ready', 'completed'].includes(order.status)) {
        this.markAnnounced(`${orderId}_order_ready`);
      }
      if (order.status === 'completed') {
        this.markAnnounced(`${orderId}_order_completed`);
      }
      if (order.status === 'cancelled' || order.status === 'rejected') {
        this.markAnnounced(`${orderId}_order_cancelled`);
      }
      if (isBillAvailable) {
        this.markAnnounced(`${orderId}_bill_ready`);
      }
      if (payStatus === 'verification_requested') {
        this.markAnnounced(`${orderId}_payment_verification_requested`);
      }
      if (payStatus === 'paid') {
        this.markAnnounced(`${orderId}_payment_confirmed`);
      }
      if (payStatus === 'not_received') {
        this.markAnnounced(`${orderId}_payment_not_received`);
      }
      return;
    }

    // Update stored baseline before announcing
    this.orderBaselines.set(orderId, {
      status: order.status,
      paymentStatus: payStatus,
      billReady: isBillAvailable,
    });

    // 1. Order status real-time transitions
    if (order.status !== prev.status) {
      if (order.status === 'accepted' || order.status === 'confirmed') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'order_confirmed',
        });
      } else if (order.status === 'preparing') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'order_preparing',
        });
      } else if (order.status === 'ready') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'order_ready',
        });
      } else if (order.status === 'completed') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'order_completed',
        });
      } else if (order.status === 'cancelled' || order.status === 'rejected') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'order_cancelled',
        });
      }
    }

    // 2. Bill Ready real-time transition
    if (
      isBillAvailable &&
      !prev.billReady &&
      order.status !== 'cancelled' &&
      order.status !== 'rejected'
    ) {
      this.announceOrderEvent({
        orderId,
        orderCode,
        tableNumber: order.table_number,
        eventKey: 'bill_ready',
      });
    }

    // 3. Payment Status real-time transitions
    if (payStatus !== prev.paymentStatus) {
      if (payStatus === 'verification_requested') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'payment_verification_requested',
        });
      } else if (payStatus === 'paid') {
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'payment_confirmed',
        });
      } else if (payStatus === 'not_received') {
        // Allow retry if owner later marks not_received again on a subsequent attempt
        this.announcedKeys.delete(`${orderId}_payment_verification_requested`);
        persistAnnouncedEventKeys(this.announcedKeys);
        this.announceOrderEvent({
          orderId,
          orderCode,
          tableNumber: order.table_number,
          eventKey: 'payment_not_received',
          allowRepeatIfNotReceived: true,
        });
      }
    }
  }

  public clearOrderBaseline(orderId: string): void {
    if (orderId) {
      this.orderBaselines.delete(orderId);
    }
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      window.clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private async processQueue(forceBrowserOnly = false): Promise<void> {
    if (this.processing) return;
    if (!this.state.enabled) return;

    this.processing = true;
    try {
      while (this.queue.length > 0 && this.state.enabled) {
        const nextItem = this.queue.shift()!;
        this.updateState({
          isSpeaking: true,
          currentText: nextItem.displayText,
          currentEventLabel: nextItem.eventLabel,
          lastError: null,
        });

        playGentleCustomerChime(Boolean(nextItem.louder));
        await new Promise((r) => window.setTimeout(r, 180));

        let outcome: 'played' | 'blocked' | 'unavailable' = 'unavailable';

        // 1. Try cached natural Gemini Indian female TTS on server first
        if (!forceBrowserOnly && !this.serverTtsUnavailable && nextItem.orderId !== 'system') {
          outcome = await this.playServerNaturalVoice(nextItem);
        }

        // 2. Fallback seamlessly to fixed browser SpeechSynthesis (Indian English female voice)
        if (outcome === 'unavailable') {
          outcome = await this.playBrowserSpeech(nextItem);
        }

        if (outcome === 'blocked') {
          // Hold item cleanly so tapping "Enable Voice Updates" immediately speaks it
          this.blockedPending = [nextItem, ...this.queue].slice(0, 4);
          this.queue = [];
          this.updateState({
            isSpeaking: false,
            currentText: null,
            currentEventLabel: null,
            autoplayBlocked: true,
            lastError: 'Tap here to enable order voice updates.',
          });
          return;
        }

        if (outcome === 'unavailable') {
          this.updateState({
            isSpeaking: false,
            currentText: null,
            currentEventLabel: null,
            lastError: 'Voice temporarily unavailable — Tap to enable voice',
          });
        } else {
          this.updateState({
            audioUnlocked: true,
            autoplayBlocked: false,
            lastSpokenText: nextItem.displayText,
            lastError: null,
          });
        }

        // Brief polite breath pause before next queued announcement
        if (this.queue.length > 0) {
          await new Promise((r) => window.setTimeout(r, 320));
        }
      }
    } finally {
      this.clearKeepAlive();
      this.processing = false;
      this.updateState({
        isSpeaking: false,
        currentText: null,
        currentEventLabel: null,
      });
    }
  }

  private async playServerNaturalVoice(
    item: CustomerVoiceQueueItem,
  ): Promise<'played' | 'blocked' | 'unavailable'> {
    const controller = new AbortController();
    const fetchTimeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch('/api/public/customer-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          eventKey: item.eventKey,
          orderCode: item.orderCode,
          tableNumber: item.tableNumber,
        }),
      });
      window.clearTimeout(fetchTimeout);
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (
        resp.status === 404 ||
        resp.status === 405 ||
        resp.status === 502 ||
        resp.status === 503 ||
        ct.includes('text/html')
      ) {
        this.serverTtsUnavailable = true;
        return 'unavailable';
      }
      if (!resp.ok || !ct.includes('audio/')) {
        return 'unavailable';
      }

      const blob = await resp.blob();
      if (blob.size < 100) return 'unavailable';

      const objectUrl = URL.createObjectURL(blob);
      try {
        const audio = new Audio(objectUrl);
        audio.volume = 1.0;
        audio.playbackRate = 0.98;
        this.activeAudio = audio;

        const result = await new Promise<'played' | 'blocked' | 'unavailable'>((resolve) => {
          let settled = false;
          const finish = (val: 'played' | 'blocked' | 'unavailable') => {
            if (settled) return;
            settled = true;
            window.clearTimeout(safetyTimer);
            resolve(val);
          };
          const safetyTimer = window.setTimeout(() => finish('played'), 25000);
          audio.onended = () => finish('played');
          audio.onerror = () => finish('unavailable');

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
              const errName = err instanceof Error ? err.name : '';
              if (errName === 'NotAllowedError') {
                finish('blocked');
              } else {
                finish('unavailable');
              }
            });
          }
        });

        return result;
      } finally {
        this.activeAudio = null;
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      window.clearTimeout(fetchTimeout);
      console.warn('[RikZen Customer Server TTS Fallback]', err);
      this.serverTtsUnavailable = true;
      return 'unavailable';
    }
  }

  private speakSingleBrowserSegment(
    synth: SpeechSynthesis,
    text: string,
    lang: 'en-IN' | 'hi-IN',
    voice: SpeechSynthesisVoice | null,
    louder: boolean,
  ): Promise<'played' | 'blocked' | 'error'> {
    return new Promise((resolve) => {
      let settled = false;
      let started = false;
      const finish = (val: 'played' | 'blocked' | 'error') => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startWatchdog);
        window.clearTimeout(endWatchdog);
        this.activeUtterance = null;
        resolve(val);
      };

      const normalized = normalizePronunciationForBrowserSpeech(text);
      const utterance = new SpeechSynthesisUtterance(normalized);
      utterance.lang = lang;
      if (voice && lang === 'en-IN') utterance.voice = voice;
      utterance.volume = 1.0;
      utterance.rate = louder ? 0.92 : 0.95;
      utterance.pitch = 1.03;

      this.activeUtterance = utterance;

      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = () => {
        finish('played');
      };
      utterance.onerror = (ev) => {
        const code = (ev as SpeechSynthesisErrorEvent)?.error || '';
        console.warn('[RikZen Customer SpeechSynthesis Error]', code);
        if (code === 'not-allowed' || code === 'audio-busy') {
          finish('blocked');
        } else if (code === 'interrupted' || code === 'canceled') {
          finish('played');
        } else {
          finish('error');
        }
      };

      // Chrome/Android watchdog if speech never starts due to autoplay policy
      const startWatchdog = window.setTimeout(() => {
        if (!started && !synth.speaking) {
          finish('blocked');
        }
      }, 2600);

      const endWatchdog = window.setTimeout(() => {
        finish('played');
      }, 15000);

      try {
        if (synth.paused) synth.resume();
        synth.speak(utterance);
      } catch (err) {
        console.error('[RikZen Customer SpeechSynthesis Throw]', err);
        finish('error');
      }
    });
  }

  private async playBrowserSpeech(
    item: CustomerVoiceQueueItem,
  ): Promise<'played' | 'blocked' | 'unavailable'> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return 'unavailable';
    }
    const synth = window.speechSynthesis;
    let preferredVoice = await resolveBestCustomerBrowserVoice();

    // Prevent Chrome desktop long-speech freeze bug by periodically resuming if paused
    this.clearKeepAlive();
    this.keepAliveTimer = window.setInterval(() => {
      try {
        if (synth.speaking && synth.paused) {
          synth.resume();
        }
      } catch {
        // Ignore
      }
    }, 3000);

    try {
      for (let i = 0; i < item.segments.length; i += 1) {
        if (!this.state.enabled) return 'played';
        const seg = item.segments[i];
        let result = await this.speakSingleBrowserSegment(
          synth,
          seg.text,
          seg.lang,
          preferredVoice,
          Boolean(item.louder),
        );

        // Safe single retry with default system voice if selected voice failed
        if (result === 'error' && preferredVoice && seg.lang === 'en-IN') {
          preferredVoice = null;
          result = await this.speakSingleBrowserSegment(synth, seg.text, seg.lang, null, Boolean(item.louder));
        }

        if (result === 'blocked') return 'blocked';
        if (result === 'error') return 'unavailable';

        // Natural polite pause between sentences
        if (i < item.segments.length - 1 && this.state.enabled) {
          await new Promise((r) => window.setTimeout(r, 240));
        }
      }
      return 'played';
    } finally {
      this.clearKeepAlive();
    }
  }
}

export const customerVoiceManager = new CustomerVoiceAnnouncementManager();
