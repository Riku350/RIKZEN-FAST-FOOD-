import { auth } from './firebase';
import type { OrderRecord } from '../types/restaurant';

export type VoiceSpeed = 'slow' | 'normal' | 'fast';
export type VoiceProfile = 'indian_female';
export type VoiceEngineUsed = 'natural_indian_female' | 'browser_indian_female' | 'unavailable';

export interface VoiceAlertSettings {
  enabled: boolean;
  volume: number; // 0 to 100
  speed: VoiceSpeed;
  voiceProfile: VoiceProfile;
  soundActivated: boolean;
}

export interface VoiceQueueState {
  isSpeaking: boolean;
  currentOrderId: string | null;
  currentTableNumber: number | null;
  currentLabel: string | null;
  queueLength: number;
  audioUnlocked: boolean;
  browserSpeechSupported: boolean;
  activeEngine: VoiceEngineUsed | null;
  lastError: string | null;
}

export interface VoiceQueueItem {
  id: string;
  orderId: string;
  tableNumber: number;
  label: string;
  segments: string[];
  fullScript: string;
  isTest?: boolean;
}

const SETTINGS_STORAGE_KEY = 'rikzen_owner_voice_settings_v1';
const ANNOUNCED_IDS_STORAGE_KEY = 'rikzen_owner_voice_announced_ids_v1';
const MAX_STORED_ANNOUNCED_IDS = 400;

export const DEFAULT_VOICE_SETTINGS: VoiceAlertSettings = {
  enabled: true,
  volume: 100,
  speed: 'normal',
  voiceProfile: 'indian_female',
  soundActivated: false,
};

export const TEST_ANNOUNCEMENT_SEGMENTS = [
  'Attention please. Test announcement.',
  'New order received. Table three.',
  'Customer Riku Kumar has ordered two Chicken Rolls and one French Fries.',
  'Total amount is two hundred and twenty rupees.',
  'Please confirm the order.',
];

export const TEST_ANNOUNCEMENT_SCRIPT = TEST_ANNOUNCEMENT_SEGMENTS.join(' ');

export function loadVoiceAlertSettings(): VoiceAlertSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceAlertSettings>;
    const speed: VoiceSpeed =
      parsed.speed === 'slow' || parsed.speed === 'normal' || parsed.speed === 'fast'
        ? parsed.speed
        : 'normal';
    const volume =
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.max(0, Math.min(100, Math.round(parsed.volume)))
        : 100;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      volume,
      speed,
      voiceProfile: 'indian_female',
      soundActivated: Boolean(parsed.soundActivated),
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceAlertSettings(settings: VoiceAlertSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadAnnouncedOrderIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(ANNOUNCED_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === 'string' && v.length > 0));
  } catch {
    return new Set();
  }
}

export function persistAnnouncedOrderIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const list = Array.from(ids);
    const trimmed =
      list.length > MAX_STORED_ANNOUNCED_IDS
        ? list.slice(list.length - MAX_STORED_ANNOUNCED_IDS)
        : list;
    window.localStorage.setItem(ANNOUNCED_IDS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// NATURAL INDIAN ENGLISH NUMBER & ORDER SCRIPT BUILDER
// ============================================================================

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function underHundredToWords(n: number): string {
  const num = Math.floor(Math.abs(n));
  if (num < 20) return ONES[num];
  const ten = Math.floor(num / 10);
  const rem = num % 10;
  return rem === 0 ? TENS[ten] : `${TENS[ten]} ${ONES[rem]}`;
}

function underThousandToWords(n: number): string {
  const num = Math.floor(Math.abs(n));
  if (num < 100) return underHundredToWords(num);
  const hundred = Math.floor(num / 100);
  const rem = num % 100;
  return rem === 0
    ? `${ONES[hundred]} hundred`
    : `${ONES[hundred]} hundred and ${underHundredToWords(rem)}`;
}

/**
 * Converts a non-negative number into clear Indian English spoken words
 * (using thousand & lakh groupings where relevant).
 */
export function numberToIndianEnglishWords(rawValue: number): string {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 'zero';
  let n = Math.floor(rawValue);
  if (n < 1000) return underThousandToWords(n);

  const parts: string[] = [];
  if (n >= 100000) {
    const lakhs = Math.floor(n / 100000);
    parts.push(`${underHundredToWords(lakhs)} lakh`);
    n %= 100000;
  }
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    parts.push(`${underHundredToWords(thousands)} thousand`);
    n %= 1000;
  }
  if (n > 0) {
    if (n < 100 && parts.length > 0) {
      parts.push(`and ${underHundredToWords(n)}`);
    } else {
      parts.push(underThousandToWords(n));
    }
  }
  return parts.join(' ');
}

export function formatRupeesInWords(amount: number): string {
  const safe = Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
  const whole = Math.floor(safe);
  const paise = Math.round((safe - whole) * 100);
  const rupeeLabel = whole === 1 ? 'rupee' : 'rupees';
  const wholeWords = `${numberToIndianEnglishWords(whole)} ${rupeeLabel}`;
  if (paise > 0) {
    const paiseLabel = paise === 1 ? 'paisa' : 'paise';
    return `${wholeWords} and ${numberToIndianEnglishWords(paise)} ${paiseLabel}`;
  }
  return wholeWords;
}

const INVARIANT_PLURAL_ENDINGS = [
  'fries',
  'momos',
  'noodles',
  'nuggets',
  'wings',
  'patties',
  'chips',
  'bites',
  'strips',
  'balls',
  'rolls',
  'burgers',
  'wraps',
  'drinks',
  'shakes',
  's',
];

function cleanSpokenItemName(name: string): string {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(french\s+)?fries\b/gi, (match) =>
      match.toLowerCase().startsWith('french') ? 'French Fries' : 'Fries',
    )
    .trim();
}

function pluralizeItemForSpeech(rawName: string, quantity: number): string {
  const cleaned = cleanSpokenItemName(rawName) || 'item';
  if (quantity <= 1) return cleaned;
  const lower = cleaned.toLowerCase();
  if (INVARIANT_PLURAL_ENDINGS.some((suffix) => lower.endsWith(suffix))) {
    return cleaned;
  }
  if (/(ch|sh|x|z)$/i.test(cleaned)) {
    return `${cleaned}es`;
  }
  if (/[^aeiou]y$/i.test(cleaned)) {
    return `${cleaned.slice(0, -1)}ies`;
  }
  return `${cleaned}s`;
}

function sanitizeCustomerNameForSpeech(rawName: string | undefined | null): string | null {
  if (!rawName || typeof rawName !== 'string') return null;
  // Strip any accidental phone numbers or long digit sequences so private numbers are NEVER spoken aloud
  const stripped = rawName
    .replace(/\+?\d[\d\s\-()]{5,}\d/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped || stripped.length < 2) return null;
  return stripped.slice(0, 60);
}

/**
 * Builds the clear, natural restaurant announcement segments for an order.
 * Always announces Table first, Customer Name (never phone), EVERY item & quantity,
 * the verified final total in rupees, and "Please confirm the order."
 */
export function buildOrderAnnouncement(order: OrderRecord): {
  segments: string[];
  fullScript: string;
} {
  const safeTable = Number.isInteger(order.table_number) ? order.table_number : 1;
  const tableWord = numberToIndianEnglishWords(safeTable);
  const safeName = sanitizeCustomerNameForSpeech(order.customer_name);

  const itemPhrases = (order.items || []).map((line) => {
    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
    const qtyWord = numberToIndianEnglishWords(qty);
    const itemName = pluralizeItemForSpeech(line.name, qty);
    return `${qtyWord} ${itemName}`;
  });

  let itemsJoined = '';
  if (itemPhrases.length === 1) {
    itemsJoined = itemPhrases[0];
  } else if (itemPhrases.length === 2) {
    itemsJoined = `${itemPhrases[0]} and ${itemPhrases[1]}`;
  } else if (itemPhrases.length > 2) {
    itemsJoined = `${itemPhrases.slice(0, -1).join(', ')}, and ${itemPhrases[itemPhrases.length - 1]}`;
  }

  const orderSentence = itemsJoined
    ? safeName
      ? `Customer ${safeName} has ordered ${itemsJoined}.`
      : `Ordered items are ${itemsJoined}.`
    : safeName
      ? `Customer ${safeName} has placed an order.`
      : 'Ordered items are listed on your dashboard.';

  const totalInWords = formatRupeesInWords(order.total);

  const segments = [
    'Attention please. New order received.',
    `Table ${tableWord}.`,
    orderSentence,
    `Total amount is ${totalInWords}.`,
    'Please confirm the order.',
  ];

  return {
    segments,
    fullScript: segments.join(' '),
  };
}

// ============================================================================
// WEB AUDIO BELL CHIME & BROWSER VOICE ENGINE + FIFO QUEUE
// ============================================================================

let sharedAudioCtx: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

export async function unlockOwnerAudioContext(): Promise<boolean> {
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
      ]);
    }
    if (ctx && ctx.state === 'running') {
      // Play an inaudible 1-sample buffer to confirm autoplay unlock on Safari/Chrome/Android
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.getVoices();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {
        // Ignore speechSynthesis warmup errors
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays a crisp, pleasant restaurant service bell chime scaled by volume (0–100).
 * Never hangs if browser AudioContext is suspended.
 */
export async function playOrderNotificationBell(volumePercent: number): Promise<void> {
  const vol = Math.max(0, Math.min(1, volumePercent / 100));
  if (vol <= 0.01) return;

  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
      ]);
    }
    if (ctx.state !== 'running') return;

    const now = ctx.currentTime;
    // Gentle two-note warm chime (E5 -> B5) like a hospitality counter bell
    const notes = [
      { freq: 659.25, start: 0, dur: 0.24, gain: 0.22 * vol },
      { freq: 987.77, start: 0.14, dur: 0.36, gain: 0.24 * vol },
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gainNode.gain.setValueAtTime(0.0001, now + note.start);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, note.gain), now + note.start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.03);
    }
    await new Promise((r) => window.setTimeout(r, 420));
  } catch {
    // Ignore audio context chime errors if blocked
  }
}

function getSpeedRate(speed: VoiceSpeed): { audioRate: number; speechRate: number } {
  switch (speed) {
    case 'slow':
      return { audioRate: 0.88, speechRate: 0.86 };
    case 'fast':
      return { audioRate: 1.04, speechRate: 1.0 };
    case 'normal':
    default:
      return { audioRate: 0.94, speechRate: 0.92 };
  }
}

function scoreIndianFemaleVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  // Strongly prefer Indian English (en-IN) so English food names like "Fries" sound clear and natural
  if (lang === 'en-in' || lang.startsWith('en-in')) score += 160;
  else if (name.includes('india') && lang.startsWith('en')) score += 120;
  else if (lang.startsWith('en-gb') || lang.startsWith('en-au')) score += 45;
  else if (lang.startsWith('en')) score += 25;
  else score -= 180; // Never use Hindi-only (hi-IN) or non-English voices that mispronounce "Fries" as "frees"

  // Strongly prefer well-known natural Indian female voices
  const preferredFemaleKeywords = [
    'neerja',
    'heera',
    'veena',
    'aditi',
    'swara',
    'raveena',
    'priya',
    'kanya',
    'ananya',
    'isha',
    'kavya',
    'sangeeta',
    'lekha',
    'female',
    'natural',
    'neural',
    'online',
  ];
  for (const kw of preferredFemaleKeywords) {
    if (name.includes(kw)) score += 45;
  }

  // Penalize clearly male or American-only voices
  const avoidKeywords = [
    'male',
    'prabhat',
    'rishi',
    'madhur',
    'david',
    'mark',
    'alex',
    'daniel',
    'fred',
    'george',
    'james',
    'guy',
    'en-us',
  ];
  for (const kw of avoidKeywords) {
    if (name.includes(kw) || lang === kw) score -= 50;
  }

  if (voice.localService === false) score += 10;
  return score;
}

async function resolveBestIndianFemaleBrowserVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  let voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 750);
      const handler = () => {
        window.clearTimeout(timeout);
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
        resolve();
      };
      window.speechSynthesis.addEventListener('voiceschanged', handler);
    });
    voices = window.speechSynthesis.getVoices();
  }
  if (voices.length === 0) return null;

  const sorted = [...voices].sort((a, b) => scoreIndianFemaleVoice(b) - scoreIndianFemaleVoice(a));
  const best = sorted[0] ?? null;
  // Never force a strongly negative-scored non-English voice; let browser default en-IN handle it
  if (best && scoreIndianFemaleVoice(best) < -20) return null;
  return best;
}

class VoiceOrderAnnouncementManager {
  private queue: VoiceQueueItem[] = [];
  private enqueuedOrderIds = new Set<string>();
  private announcedOrderIds: Set<string>;
  private settings: VoiceAlertSettings;
  private state: VoiceQueueState;
  private listeners = new Set<(next: VoiceQueueState) => void>();
  private currentAudio: HTMLAudioElement | null = null;
  private currentAbortController: AbortController | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private keepAliveTimer: number | null = null;
  private cancelledCurrent = false;
  private serverTtsUnavailable = false;
  private pendingBlockedItem: VoiceQueueItem | null = null;

  constructor() {
    this.settings = loadVoiceAlertSettings();
    this.announcedOrderIds = loadAnnouncedOrderIds();
    this.state = {
      isSpeaking: false,
      currentOrderId: null,
      currentTableNumber: null,
      currentLabel: null,
      queueLength: 0,
      audioUnlocked: false,
      browserSpeechSupported:
        typeof window !== 'undefined' && 'speechSynthesis' in window,
      activeEngine: null,
      lastError: null,
    };
  }

  public getSettings(): VoiceAlertSettings {
    return { ...this.settings };
  }

  public updateSettings(patch: Partial<VoiceAlertSettings>): VoiceAlertSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      volume:
        patch.volume !== undefined
          ? Math.max(0, Math.min(100, Math.round(patch.volume)))
          : this.settings.volume,
    };
    saveVoiceAlertSettings(this.settings);
    if (this.currentAudio) {
      this.currentAudio.volume = Math.max(0, Math.min(1, this.settings.volume / 100));
      this.currentAudio.playbackRate = getSpeedRate(this.settings.speed).audioRate;
    }
    if (!this.settings.enabled) {
      this.stopAndClearQueue();
    }
    return { ...this.settings };
  }

  public getState(): VoiceQueueState {
    return { ...this.state };
  }

  public subscribe(listener: (next: VoiceQueueState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(patch?: Partial<VoiceQueueState>) {
    if (patch) {
      this.state = { ...this.state, ...patch };
    }
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /**
   * Silently unlocks browser audio & speech on ANY user interaction (tap/click/key) in Owner Dashboard.
   * If an order arrived while autoplay was blocked, immediately speaks it once unlocked.
   */
  public async unlockOnUserGesture(): Promise<boolean> {
    if (this.state.audioUnlocked && !this.pendingBlockedItem) return true;
    const ok = await unlockOwnerAudioContext();
    if (ok) {
      this.emitState({ audioUnlocked: true, lastError: null });
      if (this.pendingBlockedItem) {
        const retryItem = this.pendingBlockedItem;
        this.pendingBlockedItem = null;
        this.queue.unshift(retryItem);
        this.emitState({ queueLength: this.queue.length });
      }
      if (this.queue.length > 0 && !this.state.isSpeaking) {
        void this.processNext();
      }
    }
    return ok;
  }

  public async enableSound(): Promise<boolean> {
    const ok = await unlockOwnerAudioContext();
    this.updateSettings({ soundActivated: true, enabled: true });
    this.emitState({ audioUnlocked: ok, lastError: null });
    if (this.pendingBlockedItem) {
      const retryItem = this.pendingBlockedItem;
      this.pendingBlockedItem = null;
      this.queue.unshift(retryItem);
      this.emitState({ queueLength: this.queue.length });
    }
    if (this.queue.length > 0 && !this.state.isSpeaking) {
      void this.processNext();
    }
    return ok;
  }

  public markOrderAlreadySeen(orderId: string): void {
    if (!orderId) return;
    if (!this.announcedOrderIds.has(orderId)) {
      this.announcedOrderIds.add(orderId);
      persistAnnouncedOrderIds(this.announcedOrderIds);
    }
  }

  public hasBeenAnnounced(orderId: string): boolean {
    return this.announcedOrderIds.has(orderId) || this.enqueuedOrderIds.has(orderId);
  }

  /**
   * Enqueues a genuinely new order for sequential chime + natural Indian female voice alert.
   * Returns true if newly enqueued, false if skipped (already announced or voice OFF).
   */
  public enqueueOrder(order: OrderRecord): boolean {
    if (!order?.id) return false;
    if (this.hasBeenAnnounced(order.id)) return false;

    this.announcedOrderIds.add(order.id);
    persistAnnouncedOrderIds(this.announcedOrderIds);

    if (!this.settings.enabled) {
      return false;
    }

    const { segments, fullScript } = buildOrderAnnouncement(order);
    const item: VoiceQueueItem = {
      id: `ord-${order.id}`,
      orderId: order.id,
      tableNumber: order.table_number,
      label: `Table ${order.table_number} · ${order.customer_name || 'Guest'}`,
      segments,
      fullScript,
    };

    this.enqueuedOrderIds.add(order.id);
    this.queue.push(item);
    this.emitState({ queueLength: this.queue.length, lastError: null });

    if (!this.state.isSpeaking) {
      void this.processNext();
    }
    return true;
  }

  /**
   * Plays the exact Test Order Announcement immediately (unlocking audio first).
   */
  public async playTestAnnouncement(): Promise<void> {
    await unlockOwnerAudioContext();
    this.updateSettings({ soundActivated: true });
    this.emitState({ audioUnlocked: true, lastError: null });

    this.queue = this.queue.filter((q) => !q.isTest);
    const testItem: VoiceQueueItem = {
      id: `test-${Date.now()}`,
      orderId: 'test-announcement',
      tableNumber: 3,
      label: 'Test Announcement · Table 3',
      segments: TEST_ANNOUNCEMENT_SEGMENTS,
      fullScript: TEST_ANNOUNCEMENT_SCRIPT,
      isTest: true,
    };
    this.queue.push(testItem);
    this.emitState({ queueLength: this.queue.length });
    if (!this.state.isSpeaking) {
      void this.processNext();
    }
  }

  /**
   * Manually replays an existing pending order's voice announcement on owner click
   * without writing synthetic IDs to persistent announcedOrderIds storage.
   */
  public async replayOrder(order: OrderRecord): Promise<void> {
    if (!order?.id) return;
    await unlockOwnerAudioContext();
    this.updateSettings({ soundActivated: true });
    this.emitState({ audioUnlocked: true, lastError: null });

    const { segments, fullScript } = buildOrderAnnouncement(order);
    this.queue.push({
      id: `replay-${order.id}-${Date.now()}`,
      orderId: order.id,
      tableNumber: order.table_number,
      label: `Table ${order.table_number} · ${order.customer_name || 'Guest'}`,
      segments,
      fullScript,
      isTest: true,
    });
    this.emitState({ queueLength: this.queue.length });
    if (!this.state.isSpeaking) {
      void this.processNext();
    }
  }

  public skipCurrent(): void {
    this.cancelledCurrent = true;
    this.stopActivePlaybackOnly();
  }

  public stopAndClearQueue(): void {
    this.cancelledCurrent = true;
    this.queue = [];
    this.pendingBlockedItem = null;
    this.stopActivePlaybackOnly();
    this.emitState({
      isSpeaking: false,
      currentOrderId: null,
      currentTableNumber: null,
      currentLabel: null,
      queueLength: 0,
    });
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      window.clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private stopActivePlaybackOnly(): void {
    this.clearKeepAlive();
    this.activeUtterance = null;
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {
        // Ignore audio stop errors
      }
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.state.isSpeaking) return;
    const next = this.queue.shift();
    if (!next) {
      this.emitState({
        isSpeaking: false,
        currentOrderId: null,
        currentTableNumber: null,
        currentLabel: null,
        queueLength: 0,
      });
      return;
    }

    if (!this.settings.enabled && !next.isTest) {
      this.enqueuedOrderIds.delete(next.orderId);
      void this.processNext();
      return;
    }

    this.cancelledCurrent = false;
    this.emitState({
      isSpeaking: true,
      currentOrderId: next.orderId,
      currentTableNumber: next.tableNumber,
      currentLabel: next.label,
      queueLength: this.queue.length,
      lastError: null,
    });

    try {
      // Step 1: Pleasant restaurant bell chime before speaking
      await playOrderNotificationBell(this.settings.volume);
      if (this.cancelledCurrent) return;

      // Step 2: Primary high-quality Natural Indian Female Voice via server-side Gemini TTS
      const naturalResult = this.serverTtsUnavailable
        ? 'fallback'
        : await this.trySpeakViaServerTts(next.fullScript);
      if (this.cancelledCurrent) return;

      if (naturalResult === 'played') {
        this.emitState({ activeEngine: 'natural_indian_female', audioUnlocked: true });
      } else {
        // Step 3: Even if HTMLAudio autoplay was blocked OR server TTS is unavailable (e.g. Netlify),
        // ALWAYS try Browser SpeechSynthesis (Indian Female voice) before declaring autoplay blocked!
        const fallbackRes = await this.trySpeakViaBrowserSynthesis(next.segments);
        if (this.cancelledCurrent) return;
        if (fallbackRes === 'played') {
          this.emitState({ activeEngine: 'browser_indian_female', audioUnlocked: true });
        } else if (fallbackRes === 'autoplay_blocked' || naturalResult === 'autoplay_blocked') {
          // Hold this order so the VERY NEXT tap anywhere on dashboard speaks it automatically!
          this.pendingBlockedItem = next;
          this.emitState({
            audioUnlocked: false,
            lastError:
              'Tap anywhere or click "ENABLE SOUND" to unlock speaker for voice order alerts.',
          });
        } else {
          this.emitState({
            activeEngine: 'unavailable',
            lastError:
              'Browser speaker voice is unavailable on this device. Visual order alerts and bell chimes remain active.',
          });
        }
      }
    } finally {
      this.clearKeepAlive();
      this.activeUtterance = null;
      this.enqueuedOrderIds.delete(next.orderId);
      const hasMore = this.queue.length > 0;
      this.emitState({
        isSpeaking: false,
        currentOrderId: null,
        currentTableNumber: null,
        currentLabel: null,
        queueLength: this.queue.length,
      });

      if (hasMore && (this.settings.enabled || this.queue[0]?.isTest)) {
        window.setTimeout(() => {
          void this.processNext();
        }, 650);
      }
    }
  }

  private async trySpeakViaServerTts(
    script: string,
  ): Promise<'played' | 'autoplay_blocked' | 'fallback'> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return 'fallback';
      const token = await currentUser.getIdToken();
      if (!token || this.cancelledCurrent) return 'fallback';

      const controller = new AbortController();
      this.currentAbortController = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);

      let resp: Response;
      try {
        resp = await fetch('/api/owner/voice-alert-tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: script,
            speed: this.settings.speed,
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (this.currentAbortController === controller) {
          this.currentAbortController = null;
        }
      }

      if (this.cancelledCurrent) return 'played';
      const contentType = (resp.headers.get('content-type') || '').toLowerCase();

      // If static-hosted (404/405/HTML) or TTS not configured (503), cache for this session so
      // future orders speak INSTANTLY via browser voice with zero network delay!
      if (
        resp.status === 404 ||
        resp.status === 405 ||
        resp.status === 503 ||
        contentType.includes('text/html')
      ) {
        this.serverTtsUnavailable = true;
        return 'fallback';
      }

      if (!resp.ok || !contentType.includes('audio/')) {
        return 'fallback';
      }

      const wavBlob = await resp.blob();
      if (wavBlob.size < 100 || this.cancelledCurrent) return 'fallback';

      const objectUrl = URL.createObjectURL(wavBlob);
      try {
        const audio = new Audio(objectUrl);
        audio.volume = Math.max(0, Math.min(1, this.settings.volume / 100));
        audio.playbackRate = getSpeedRate(this.settings.speed).audioRate;
        this.currentAudio = audio;

        return await new Promise<'played' | 'autoplay_blocked' | 'fallback'>((resolve) => {
          const cleanup = () => {
            if (this.currentAudio === audio) {
              this.currentAudio = null;
            }
          };
          audio.onended = () => {
            cleanup();
            resolve('played');
          };
          audio.onerror = () => {
            cleanup();
            resolve('fallback');
          };
          const playPromise = audio.play();
          if (playPromise) {
            playPromise.catch((err) => {
              cleanup();
              const errName = err instanceof Error ? err.name : '';
              if (errName === 'NotAllowedError') {
                resolve('autoplay_blocked');
              } else {
                resolve('fallback');
              }
            });
          }
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return 'fallback';
    }
  }

  private speakSingleSegment(
    synth: SpeechSynthesis,
    segmentText: string,
    preferredVoice: SpeechSynthesisVoice | null,
    speechRate: number,
    vol: number,
  ): Promise<'ok' | 'blocked' | 'error'> {
    return new Promise<'ok' | 'blocked' | 'error'>((resolve) => {
      let settled = false;
      const finish = (status: 'ok' | 'blocked' | 'error') => {
        if (settled) return;
        settled = true;
        window.clearTimeout(safetyTimer);
        if (this.activeUtterance === utterance) {
          this.activeUtterance = null;
        }
        resolve(status);
      };

      const utterance = new SpeechSynthesisUtterance(segmentText);
      utterance.lang = preferredVoice?.lang || 'en-IN';
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.rate = speechRate;
      utterance.pitch = 1.03;
      utterance.volume = vol;

      // Hold strong reference to prevent Chrome/Safari garbage collection cutting off speech!
      this.activeUtterance = utterance;

      const safetyTimer = window.setTimeout(() => finish('ok'), 16000);
      utterance.onend = () => finish('ok');
      utterance.onerror = (event) => {
        const errCode = (event as SpeechSynthesisErrorEvent).error;
        if (errCode === 'not-allowed') {
          finish('blocked');
        } else if (errCode === 'canceled' || errCode === 'interrupted') {
          finish('ok');
        } else {
          finish('error');
        }
      };

      try {
        if (synth.paused) {
          synth.resume();
        }
        synth.speak(utterance);
      } catch {
        finish('error');
      }
    });
  }

  private async trySpeakViaBrowserSynthesis(
    segments: string[],
  ): Promise<'played' | 'autoplay_blocked' | 'unavailable'> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return 'unavailable';
    }
    const synth = window.speechSynthesis;
    let preferredVoice = await resolveBestIndianFemaleBrowserVoice();
    const { speechRate } = getSpeedRate(this.settings.speed);
    const vol = Math.max(0, Math.min(1, this.settings.volume / 100));

    // Only cancel if already busy, and wait 70ms so Chrome/Android never swallows the next speak()
    try {
      if (synth.speaking || synth.pending) {
        synth.cancel();
        await new Promise((r) => window.setTimeout(r, 70));
      }
      if (synth.paused) {
        synth.resume();
      }
    } catch {
      // Ignore
    }

    // Chrome desktop/Android anti-pause heartbeat while speaking
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
      for (let i = 0; i < segments.length; i++) {
        if (this.cancelledCurrent) return 'played';
        const segmentText = segments[i];

        let result = await this.speakSingleSegment(
          synth,
          segmentText,
          preferredVoice,
          speechRate,
          vol,
        );

        // If a specific selected voice errored on this device, retry once with default system voice
        if (result === 'error' && preferredVoice) {
          preferredVoice = null;
          result = await this.speakSingleSegment(synth, segmentText, null, speechRate, vol);
        }

        if (result === 'blocked') return 'autoplay_blocked';
        if (result === 'error') return 'unavailable';

        // Natural polite pause between announcement sections
        if (i < segments.length - 1 && !this.cancelledCurrent) {
          await new Promise((r) => window.setTimeout(r, 220));
        }
      }
      return 'played';
    } finally {
      this.clearKeepAlive();
    }
  }
}

export const voiceOrderAlertManager = new VoiceOrderAnnouncementManager();

// ============================================================================
// CUSTOMER-FACING ORDER CANCELLATION VOICE ALERT (NATURAL INDIAN FEMALE)
// ============================================================================

const CUSTOMER_CANCELLED_ANNOUNCED_KEY = 'rikzen_customer_cancelled_voice_v1';
const CUSTOMER_CANCEL_TEXT =
  'Your order has been cancelled. Please contact RikZen Fast Food for assistance.';
let customerCancelSpeaking = false;
let customerCancelServerTtsFailed = false;
let customerActiveUtterance: SpeechSynthesisUtterance | null = null;

function hasCustomerCancelBeenSpoken(orderId: string): boolean {
  if (typeof window === 'undefined' || !orderId) return true;
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_CANCELLED_ANNOUNCED_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) && arr.includes(orderId);
  } catch {
    return false;
  }
}

function markCustomerCancelSpoken(orderId: string): void {
  if (typeof window === 'undefined' || !orderId) return;
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_CANCELLED_ANNOUNCED_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(orderId)) {
      list.push(orderId);
      window.sessionStorage.setItem(
        CUSTOMER_CANCELLED_ANNOUNCED_KEY,
        JSON.stringify(list.slice(-50)),
      );
    }
  } catch {
    // Ignore storage errors
  }
}

export async function unlockCustomerAudioOnGesture(): Promise<void> {
  await unlockOwnerAudioContext();
}

/**
 * Announces order cancellation once per order in a clear, loud, polite Indian female voice.
 * Uses cached server Gemini Indian female TTS when available, with en-IN browser speech fallback.
 */
export async function speakCustomerOrderCancelled(orderId: string): Promise<void> {
  if (!orderId || customerCancelSpeaking || hasCustomerCancelBeenSpoken(orderId)) return;
  markCustomerCancelSpoken(orderId);
  customerCancelSpeaking = true;

  try {
    // 1. Try cached natural Indian female TTS from server
    if (!customerCancelServerTtsFailed) {
      try {
        const resp = await fetch('/api/public/cancellation-tts', { method: 'GET' });
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (resp.ok && ct.includes('audio/')) {
          const blob = await resp.blob();
          if (blob.size > 100) {
            const url = URL.createObjectURL(blob);
            try {
              const audio = new Audio(url);
              audio.volume = 1.0;
              audio.playbackRate = 0.96;
              const played = await new Promise<boolean>((resolve) => {
                audio.onended = () => resolve(true);
                audio.onerror = () => resolve(false);
                const p = audio.play();
                if (p) p.catch(() => resolve(false));
              });
              if (played) return;
            } finally {
              URL.revokeObjectURL(url);
            }
          }
        } else if (resp.status === 404 || resp.status === 405 || resp.status === 503 || ct.includes('text/html')) {
          customerCancelServerTtsFailed = true;
        }
      } catch {
        customerCancelServerTtsFailed = true;
      }
    }

    // 2. Clean browser Indian English female speech fallback (volume 1.0, rate 0.93)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const synth = window.speechSynthesis;
      const voice = await resolveBestIndianFemaleBrowserVoice();
      if (synth.speaking || synth.pending) {
        synth.cancel();
        await new Promise((r) => window.setTimeout(r, 70));
      }
      if (synth.paused) synth.resume();

      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(CUSTOMER_CANCEL_TEXT);
        utterance.lang = voice?.lang || 'en-IN';
        if (voice) utterance.voice = voice;
        utterance.volume = 1.0;
        utterance.rate = 0.93;
        utterance.pitch = 1.02;
        customerActiveUtterance = utterance;
        const timer = window.setTimeout(() => {
          customerActiveUtterance = null;
          resolve();
        }, 12000);
        utterance.onend = () => {
          window.clearTimeout(timer);
          customerActiveUtterance = null;
          resolve();
        };
        utterance.onerror = () => {
          window.clearTimeout(timer);
          customerActiveUtterance = null;
          resolve();
        };
        try {
          synth.speak(utterance);
        } catch {
          window.clearTimeout(timer);
          customerActiveUtterance = null;
          resolve();
        }
      });
    }
  } finally {
    customerCancelSpeaking = false;
  }
}
