import { OrderRecord } from '../types/restaurant';
import { timestampToDate } from './orderService';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface DateRangeBounds {
  start: Date;
  end: Date;
  label: string;
}

/**
 * STRICT MANUAL PAYMENT REVENUE RULE:
 * Only non-cancelled orders that the Owner manually verified as `payment_status === 'paid'`
 * count as completed revenue. Never counts pending, verification_requested, not_received,
 * failed, rejected, or cancelled orders as revenue.
 */
export function isRevenueOrder(order: OrderRecord): boolean {
  if (order.status === 'rejected' || order.status === 'cancelled') return false;
  return order.payment_status === 'paid';
}

export function isCancelledOrder(order: OrderRecord): boolean {
  return order.status === 'rejected' || order.status === 'cancelled';
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Monday-start week helper */
export function startOfIsoWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function endOfIsoWeek(date: Date): Date {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

export function getIsoWeekNumber(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function formatIsoDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDateRangeForPreset(
  preset: DatePreset,
  customStartStr?: string,
  customEndStr?: string,
  now: Date = new Date(),
): DateRangeBounds {
  const fmtShort = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  switch (preset) {
    case 'today': {
      const s = startOfDay(now);
      const e = endOfDay(now);
      return { start: s, end: e, label: fmtShort(s) };
    }
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const s = startOfDay(y);
      const e = endOfDay(y);
      return { start: s, end: e, label: fmtShort(s) };
    }
    case 'this_week': {
      const s = startOfIsoWeek(now);
      const e = endOfIsoWeek(now);
      return { start: s, end: e, label: `${fmtShort(s)} – ${fmtShort(e)}` };
    }
    case 'last_week': {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 7);
      const s = startOfIsoWeek(prev);
      const e = endOfIsoWeek(prev);
      return { start: s, end: e, label: `${fmtShort(s)} – ${fmtShort(e)}` };
    }
    case 'this_month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return {
        start: s,
        end: e,
        label: s.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      };
    }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return {
        start: s,
        end: e,
        label: s.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      };
    }
    case 'custom': {
      const parsedStart = customStartStr ? new Date(`${customStartStr}T00:00:00`) : startOfDay(now);
      const parsedEnd = customEndStr ? new Date(`${customEndStr}T23:59:59.999`) : endOfDay(now);
      const validStart = Number.isNaN(parsedStart.getTime()) ? startOfDay(now) : parsedStart;
      const validEnd = Number.isNaN(parsedEnd.getTime()) ? endOfDay(now) : parsedEnd;
      const start = validStart <= validEnd ? validStart : validEnd;
      const end = validEnd >= validStart ? validEnd : validStart;
      return { start, end, label: `${fmtShort(start)} – ${fmtShort(end)}` };
    }
  }
}

export function filterOrdersInRange(orders: OrderRecord[], bounds: DateRangeBounds): OrderRecord[] {
  const startMs = bounds.start.getTime();
  const endMs = bounds.end.getTime();
  return orders.filter((o) => {
    const ms = timestampToDate(o.created_at).getTime();
    return ms >= startMs && ms <= endMs;
  });
}

export interface ChartBucket {
  label: string;
  sales: number;
  orders: number;
  totalOrders?: number;
  paidOrders?: number;
  pendingPayments?: number;
}

export interface BestSellingItemStat {
  name: string;
  qty: number;
  revenue: number;
}

export function computeBestSellingItem(orders: OrderRecord[]): BestSellingItemStat | null {
  const counts = new Map<string, BestSellingItemStat>();
  for (const o of orders) {
    if (!isRevenueOrder(o)) continue;
    for (const line of o.items) {
      const key = line.menu_item_id || line.name;
      const prev = counts.get(key) || { name: line.name, qty: 0, revenue: 0 };
      prev.qty += line.quantity;
      prev.revenue += line.line_total;
      counts.set(key, prev);
    }
  }
  let best: BestSellingItemStat | null = null;
  for (const item of counts.values()) {
    if (!best || item.qty > best.qty || (item.qty === best.qty && item.revenue > best.revenue)) {
      best = item;
    }
  }
  return best;
}

/**
 * Hourly sales breakdown for a given day (strictly manually verified paid orders count as revenue).
 */
export function buildHourlySalesSeries(orders: OrderRecord[], targetDay: Date = new Date()): {
  buckets: ChartBucket[];
  totalSales: number;
  totalOrders: number;
  allDayOrdersCount: number;
  completedOrdersCount: number;
  paidOrdersCount: number;
  pendingPaymentsCount: number;
  unpaidAmount: number;
  cancelledOrdersCount: number;
  avgOrderValue: number;
  bestSellingItem: BestSellingItemStat | null;
  completedOrders: OrderRecord[];
} {
  const bounds = { start: startOfDay(targetDay), end: endOfDay(targetDay), label: '' };
  const allDayOrders = filterOrdersInRange(orders, bounds);
  const cancelledOrdersCount = allDayOrders.filter(isCancelledOrder).length;
  const activeDayOrders = allDayOrders.filter((o) => !isCancelledOrder(o));
  const completedOrdersCount = activeDayOrders.filter((o) => o.status === 'completed').length;
  const dayOrders = activeDayOrders.filter(isRevenueOrder);
  const pendingPaymentOrders = activeDayOrders.filter((o) => o.payment_status !== 'paid');
  const unpaidAmount = pendingPaymentOrders.reduce((sum, o) => sum + o.total, 0);

  const hourTotals = new Map<number, { sales: number; orders: number }>();
  let minHour = 10;
  let maxHour = 22;

  for (const ord of dayOrders) {
    const hr = timestampToDate(ord.created_at).getHours();
    if (hr < minHour) minHour = hr;
    if (hr > maxHour) maxHour = hr;
    const prev = hourTotals.get(hr) || { sales: 0, orders: 0 };
    prev.sales += ord.total;
    prev.orders += 1;
    hourTotals.set(hr, prev);
  }

  const buckets: ChartBucket[] = [];
  for (let h = minHour; h <= maxHour; h++) {
    const entry = hourTotals.get(h) || { sales: 0, orders: 0 };
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    buckets.push({
      label: `${hour12}${suffix}`,
      sales: entry.sales,
      orders: entry.orders,
    });
  }

  const totalSales = dayOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = dayOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

  return {
    buckets,
    totalSales,
    totalOrders,
    allDayOrdersCount: allDayOrders.length,
    completedOrdersCount,
    paidOrdersCount: dayOrders.length,
    pendingPaymentsCount: pendingPaymentOrders.length,
    unpaidAmount,
    cancelledOrdersCount,
    avgOrderValue,
    bestSellingItem: computeBestSellingItem(dayOrders),
    completedOrders: dayOrders,
  };
}

/**
 * Weekly Monday-to-Sunday breakdown from real orders (revenue strictly from paid orders).
 */
export function buildWeeklySalesSeries(orders: OrderRecord[], refDate: Date = new Date()): {
  buckets: ChartBucket[];
  totalSales: number;
  totalOrders: number;
  allWeekOrdersCount: number;
  paidOrdersCount: number;
  pendingPaymentsCount: number;
  unpaidAmount: number;
  avgOrderValue: number;
  bestDay: ChartBucket | null;
  bestSellingItem: BestSellingItemStat | null;
  completedOrders: OrderRecord[];
  periodLabel: string;
} {
  const start = startOfIsoWeek(refDate);
  const end = endOfIsoWeek(refDate);
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const allWeekOrders = filterOrdersInRange(orders, { start, end, label: '' }).filter(
    (o) => !isCancelledOrder(o),
  );
  const weekOrders = allWeekOrders.filter(isRevenueOrder);
  const pendingWeekOrders = allWeekOrders.filter((o) => o.payment_status !== 'paid');
  const unpaidAmount = pendingWeekOrders.reduce((sum, o) => sum + o.total, 0);

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets: ChartBucket[] = dayNames.map((label) => ({
    label,
    sales: 0,
    orders: 0,
    totalOrders: 0,
    paidOrders: 0,
    pendingPayments: 0,
  }));

  for (const ord of allWeekOrders) {
    const d = timestampToDate(ord.created_at);
    const dayIdx = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    buckets[dayIdx].totalOrders = (buckets[dayIdx].totalOrders || 0) + 1;
    if (isRevenueOrder(ord)) {
      buckets[dayIdx].sales += ord.total;
      buckets[dayIdx].orders += 1;
      buckets[dayIdx].paidOrders = (buckets[dayIdx].paidOrders || 0) + 1;
    } else {
      buckets[dayIdx].pendingPayments = (buckets[dayIdx].pendingPayments || 0) + 1;
    }
  }

  const totalSales = weekOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = weekOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

  let bestDay: ChartBucket | null = null;
  for (const b of buckets) {
    if (b.sales > 0 && (!bestDay || b.sales > bestDay.sales)) {
      bestDay = b;
    }
  }

  return {
    buckets,
    totalSales,
    totalOrders,
    allWeekOrdersCount: allWeekOrders.length,
    paidOrdersCount: weekOrders.length,
    pendingPaymentsCount: pendingWeekOrders.length,
    unpaidAmount,
    avgOrderValue,
    bestDay,
    bestSellingItem: computeBestSellingItem(weekOrders),
    completedOrders: weekOrders,
    periodLabel: `${fmt(start)} – ${fmt(end)}`,
  };
}

/**
 * Monthly Jan-Dec breakdown for a year from real completed orders.
 */
export function buildMonthlySalesSeries(orders: OrderRecord[], year: number = new Date().getFullYear()): {
  buckets: ChartBucket[];
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  completedOrders: OrderRecord[];
  currentMonthOrders: OrderRecord[];
  currentMonthAllCount: number;
  currentMonthCompletedCount: number;
  currentMonthPendingPaymentsCount: number;
  currentMonthUnpaidAmount: number;
  currentMonthSales: number;
  currentMonthAvg: number;
  currentMonthDiscounts: number;
  currentMonthBestItem: BestSellingItemStat | null;
  currentMonthBestDay: { dateLabel: string; sales: number } | null;
} {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buckets: ChartBucket[] = monthNames.map((label) => ({
    label,
    sales: 0,
    orders: 0,
    totalOrders: 0,
    paidOrders: 0,
    pendingPayments: 0,
  }));

  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const yearOrders: OrderRecord[] = [];
  const currentMonthOrders: OrderRecord[] = [];
  let currentMonthAllCount = 0;
  let currentMonthCompletedCount = 0;
  let currentMonthPendingPaymentsCount = 0;
  let currentMonthUnpaidAmount = 0;
  const monthDayTotals = new Map<string, { dateLabel: string; sales: number }>();

  for (const ord of orders) {
    if (isCancelledOrder(ord)) continue;
    const d = timestampToDate(ord.created_at);
    if (d.getFullYear() !== year) continue;
    const m = d.getMonth();
    buckets[m].totalOrders = (buckets[m].totalOrders || 0) + 1;
    if (m === currentMonthIdx) {
      currentMonthAllCount += 1;
      if (ord.status === 'completed') currentMonthCompletedCount += 1;
      if (ord.payment_status !== 'paid') {
        currentMonthPendingPaymentsCount += 1;
        currentMonthUnpaidAmount += ord.total;
      }
    }

    if (!isRevenueOrder(ord)) {
      buckets[m].pendingPayments = (buckets[m].pendingPayments || 0) + 1;
      continue;
    }

    buckets[m].sales += ord.total;
    buckets[m].orders += 1;
    buckets[m].paidOrders = (buckets[m].paidOrders || 0) + 1;
    yearOrders.push(ord);
    if (m === currentMonthIdx) {
      currentMonthOrders.push(ord);
      const dayKey = formatIsoDateLocal(d);
      const prev = monthDayTotals.get(dayKey) || {
        dateLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        sales: 0,
      };
      prev.sales += ord.total;
      monthDayTotals.set(dayKey, prev);
    }
  }

  const totalSales = yearOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = yearOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

  const currentMonthSales = currentMonthOrders.reduce((sum, o) => sum + o.total, 0);
  const currentMonthDiscounts = currentMonthOrders.reduce((sum, o) => sum + (o.discount || 0), 0);
  const currentMonthAvg =
    currentMonthOrders.length > 0 ? Math.round(currentMonthSales / currentMonthOrders.length) : 0;

  let currentMonthBestDay: { dateLabel: string; sales: number } | null = null;
  for (const entry of monthDayTotals.values()) {
    if (entry.sales > 0 && (!currentMonthBestDay || entry.sales > currentMonthBestDay.sales)) {
      currentMonthBestDay = entry;
    }
  }

  return {
    buckets,
    totalSales,
    totalOrders,
    avgOrderValue,
    completedOrders: yearOrders,
    currentMonthOrders,
    currentMonthAllCount,
    currentMonthCompletedCount,
    currentMonthPendingPaymentsCount,
    currentMonthUnpaidAmount,
    currentMonthSales,
    currentMonthAvg,
    currentMonthDiscounts,
    currentMonthBestItem: computeBestSellingItem(currentMonthOrders),
    currentMonthBestDay,
  };
}

export function getDailyReportFilename(date: Date = new Date()): string {
  return `RikZen-Daily-Report-${formatIsoDateLocal(date)}.pdf`;
}

export function getWeeklyReportFilename(date: Date = new Date()): string {
  const { year, week } = getIsoWeekNumber(date);
  return `RikZen-Weekly-Report-${year}-W${String(week).padStart(2, '0')}.pdf`;
}

export function getMonthlyReportFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `RikZen-Monthly-Report-${y}-${m}.pdf`;
}
