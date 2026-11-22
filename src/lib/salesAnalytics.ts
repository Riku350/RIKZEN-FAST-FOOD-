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
 * STRICT REVENUE RULE:
 * Only verified completed/paid orders count as revenue.
 * Never counts rejected, cancelled, or pending orders.
 */
export function isRevenueOrder(order: OrderRecord): boolean {
  return order.status === 'completed';
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
}

/**
 * Hourly sales breakdown for a given day (real completed orders only).
 */
export function buildHourlySalesSeries(orders: OrderRecord[], targetDay: Date = new Date()): {
  buckets: ChartBucket[];
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  completedOrders: OrderRecord[];
} {
  const bounds = { start: startOfDay(targetDay), end: endOfDay(targetDay), label: '' };
  const dayOrders = filterOrdersInRange(orders, bounds).filter(isRevenueOrder);

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

  return { buckets, totalSales, totalOrders, avgOrderValue, completedOrders: dayOrders };
}

/**
 * Weekly Monday-to-Sunday breakdown from real completed orders.
 */
export function buildWeeklySalesSeries(orders: OrderRecord[], refDate: Date = new Date()): {
  buckets: ChartBucket[];
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  bestDay: ChartBucket | null;
  completedOrders: OrderRecord[];
  periodLabel: string;
} {
  const start = startOfIsoWeek(refDate);
  const end = endOfIsoWeek(refDate);
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const weekOrders = filterOrdersInRange(orders, { start, end, label: '' }).filter(isRevenueOrder);

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets: ChartBucket[] = dayNames.map((label) => ({ label, sales: 0, orders: 0 }));

  for (const ord of weekOrders) {
    const d = timestampToDate(ord.created_at);
    const dayIdx = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    buckets[dayIdx].sales += ord.total;
    buckets[dayIdx].orders += 1;
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
    avgOrderValue,
    bestDay,
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
  currentMonthSales: number;
  currentMonthAvg: number;
} {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buckets: ChartBucket[] = monthNames.map((label) => ({ label, sales: 0, orders: 0 }));

  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const yearOrders: OrderRecord[] = [];
  const currentMonthOrders: OrderRecord[] = [];

  for (const ord of orders) {
    if (!isRevenueOrder(ord)) continue;
    const d = timestampToDate(ord.created_at);
    if (d.getFullYear() !== year) continue;
    const m = d.getMonth();
    buckets[m].sales += ord.total;
    buckets[m].orders += 1;
    yearOrders.push(ord);
    if (m === currentMonthIdx) {
      currentMonthOrders.push(ord);
    }
  }

  const totalSales = yearOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = yearOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

  const currentMonthSales = currentMonthOrders.reduce((sum, o) => sum + o.total, 0);
  const currentMonthAvg =
    currentMonthOrders.length > 0 ? Math.round(currentMonthSales / currentMonthOrders.length) : 0;

  return {
    buckets,
    totalSales,
    totalOrders,
    avgOrderValue,
    completedOrders: yearOrders,
    currentMonthOrders,
    currentMonthSales,
    currentMonthAvg,
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
