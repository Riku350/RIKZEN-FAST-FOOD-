import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileDown,
  Loader2,
  RefreshCw,
  Search,
  Send,
  TrendingUp,
} from 'lucide-react';
import {
  downloadSalesReportPdf,
  formatIndianMobileDisplay,
  formatOrderDate,
  formatRupees,
} from '../lib/orderService';
import {
  buildHourlySalesSeries,
  buildMonthlySalesSeries,
  buildWeeklySalesSeries,
  ChartBucket,
  DatePreset,
  filterOrdersInRange,
  formatIsoDateLocal,
  getDailyReportFilename,
  getDateRangeForPreset,
  getMonthlyReportFilename,
  getWeeklyReportFilename,
  isRevenueOrder,
} from '../lib/salesAnalytics';
import { OrderRecord } from '../types/restaurant';

/**
 * Smooth numeric count-up that respects `prefers-reduced-motion`.
 */
export const AnimatedNumber: React.FC<{
  value: number;
  prefix?: string;
  suffix?: string;
}> = ({ value, prefix = '', suffix = '' }) => {
  const prefersReduced = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const startVal = prevValueRef.current;
    prevValueRef.current = value;

    if (prefersReduced || startVal === value) {
      setDisplayValue(value);
      return;
    }

    const durationMs = 460;
    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startVal + (value - startVal) * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, prefersReduced]);

  return (
    <span className="tabular-nums">
      {prefix}
      {Math.round(displayValue).toLocaleString('en-IN')}
      {suffix}
    </span>
  );
};

/**
 * Clean animated vertical bar chart built with pure Tailwind + Motion compositor transforms.
 * Shows real zero-state honestly without any fake bars.
 */
export const AnimatedSalesBarChart: React.FC<{
  buckets: ChartBucket[];
  accentColor?: string;
  highlightLabel?: string | null;
  emptyMessage?: string;
  compact?: boolean;
}> = ({
  buckets,
  accentColor = '#E5391B',
  highlightLabel = null,
  emptyMessage = 'No completed sales recorded in this period yet.',
  compact = false,
}) => {
  const prefersReduced = useReducedMotion();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxSales = useMemo(
    () => buckets.reduce((max, b) => (b.sales > max ? b.sales : max), 0),
    [buckets],
  );

  if (maxSales <= 0) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 flex flex-col items-center justify-center text-center px-4 ${
          compact ? 'h-44' : 'h-56'
        }`}
      >
        <TrendingUp className="w-6 h-6 text-neutral-400 mb-2" />
        <p className="text-sm font-bold text-neutral-700">₹0 Completed Sales</p>
        <p className="text-xs text-neutral-500 mt-0.5 max-w-xs">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`relative rounded-2xl border border-neutral-200/80 bg-neutral-50/50 px-3 sm:px-4 pt-6 pb-3 flex items-end justify-between gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar ${
          compact ? 'h-48' : 'h-60'
        }`}
      >
        {/* Subtle horizontal reference lines */}
        <div className="pointer-events-none absolute inset-x-3 top-6 bottom-9 flex flex-col justify-between">
          <div className="border-t border-neutral-200/70 border-dashed" />
          <div className="border-t border-neutral-200/60 border-dashed" />
          <div className="border-t border-neutral-200/50" />
        </div>

        {buckets.map((bucket, idx) => {
          const pct = maxSales > 0 ? Math.max(bucket.sales > 0 ? 6 : 0, (bucket.sales / maxSales) * 100) : 0;
          const isHighlight = highlightLabel === bucket.label || hoveredIdx === idx;
          return (
            <div
              key={`${bucket.label}-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="relative flex-1 min-w-[26px] h-full flex flex-col items-center justify-end group"
            >
              {/* Value label on hover or best bar */}
              {bucket.sales > 0 && (
                <div
                  className={`mb-1 text-[10px] font-mono font-bold tabular-nums transition-opacity whitespace-nowrap ${
                    isHighlight ? 'opacity-100 text-neutral-900' : 'opacity-0 group-hover:opacity-100 text-neutral-700'
                  }`}
                >
                  {formatRupees(bucket.sales)}
                </div>
              )}

              <div className="w-full flex-1 flex items-end justify-center">
                <motion.div
                  initial={prefersReduced ? false : { scaleY: 0, opacity: 0.5 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ duration: 0.35, delay: Math.min(idx * 0.025, 0.25), ease: 'easeOut' }}
                  style={{
                    height: `${pct}%`,
                    transformOrigin: 'bottom',
                    backgroundColor:
                      bucket.sales <= 0
                        ? '#E5E7EB'
                        : isHighlight
                          ? accentColor
                          : '#1F2937',
                  }}
                  title={`${bucket.label}: ${formatRupees(bucket.sales)} (${bucket.orders} completed)`}
                  className="w-full max-w-[34px] rounded-t-lg transition-colors"
                />
              </div>

              <span className="mt-2 text-[10px] sm:text-[11px] font-semibold text-neutral-500 tabular-nums whitespace-nowrap">
                {bucket.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface OwnerAnalyticsSectionProps {
  orders: OrderRecord[];
  onViewOrder: (order: OrderRecord) => void;
  onDownloadBill: (order: OrderRecord) => void;
  onSendWhatsApp: (order: OrderRecord) => void;
  onMarkPaid?: (order: OrderRecord) => void;
  downloadingBillId: string | null;
  sendingWaOrderId: string | null;
  updatingPaymentId?: string | null;
  onToast: (msg: string) => void;
}

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'custom', label: 'Custom Range' },
];

export const OwnerAnalyticsSection: React.FC<OwnerAnalyticsSectionProps> = ({
  orders,
  onViewOrder,
  onDownloadBill,
  onSendWhatsApp,
  onMarkPaid,
  downloadingBillId,
  sendingWaOrderId,
  updatingPaymentId = null,
  onToast,
}) => {
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState(() => formatIsoDateLocal(new Date()));
  const [customEnd, setCustomEnd] = useState(() => formatIsoDateLocal(new Date()));
  const [activeChartTab, setActiveChartTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [historySearch, setHistorySearch] = useState('');

  // PDF Sales Report download states
  const [downloadingReport, setDownloadingReport] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);

  // Selected date filter bounds (updates live without refresh)
  const activeRange = useMemo(
    () => getDateRangeForPreset(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd],
  );

  // Orders inside active date range
  const ordersInRange = useMemo(
    () => filterOrdersInRange(orders, activeRange),
    [orders, activeRange],
  );

  // Strict completed-only revenue inside active date range
  const completedInRange = useMemo(
    () => ordersInRange.filter(isRevenueOrder),
    [ordersInRange],
  );

  const rangeMetrics = useMemo(() => {
    const totalSales = completedInRange.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = completedInRange.length;
    const avgOrder = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
    const discounts = completedInRange.reduce((sum, o) => sum + (o.discount || 0), 0);

    // Top dishes in completed orders of selected period
    const dishMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of completedInRange) {
      for (const line of o.items) {
        const prev = dishMap.get(line.menu_item_id) || { name: line.name, qty: 0, revenue: 0 };
        prev.qty += line.quantity;
        prev.revenue += line.line_total;
        dishMap.set(line.menu_item_id, prev);
      }
    }
    const topDishes = Array.from(dishMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const nonRejectedInRange = ordersInRange.filter((o) => o.status !== 'rejected');
    const paidCount = nonRejectedInRange.filter((o) => o.payment_status === 'paid').length;
    const pendingPayCount = nonRejectedInRange.filter((o) => o.payment_status !== 'paid').length;

    return {
      totalSales,
      totalOrders,
      allPeriodOrders: ordersInRange.length,
      paidCount,
      pendingPayCount,
      avgOrder,
      discounts,
      topDishes,
    };
  }, [completedInRange, ordersInRange]);

  // Real Daily, Weekly, Monthly series (strictly completed orders)
  const dailyRefDate = useMemo(() => {
    if (datePreset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return y;
    }
    return new Date();
  }, [datePreset]);

  const weeklyRefDate = useMemo(() => {
    if (datePreset === 'last_week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d;
    }
    return new Date();
  }, [datePreset]);

  const dailySeries = useMemo(
    () => buildHourlySalesSeries(orders, dailyRefDate),
    [orders, dailyRefDate],
  );

  const weeklySeries = useMemo(
    () => buildWeeklySalesSeries(orders, weeklyRefDate),
    [orders, weeklyRefDate],
  );

  const monthlySeries = useMemo(
    () => buildMonthlySalesSeries(orders, now.getFullYear()),
    [orders, now],
  );

  // Automatically align chart view when user clicks a preset
  const handlePresetClick = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'today' || preset === 'yesterday') setActiveChartTab('daily');
    else if (preset === 'this_week' || preset === 'last_week') setActiveChartTab('weekly');
    else if (preset === 'this_month' || preset === 'last_month') setActiveChartTab('monthly');
  };

  // Searchable Order History within the selected date range
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return ordersInRange;
    return ordersInRange.filter(
      (o) =>
        o.order_code.toLowerCase().includes(q) ||
        String(o.order_number).includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_mobile.toLowerCase().includes(q) ||
        `table ${o.table_number}`.includes(q),
    );
  }, [ordersInRange, historySearch]);

  const handleDownloadReport = async (kind: 'daily' | 'weekly' | 'monthly' | 'custom') => {
    if (downloadingReport) return;
    setDownloadingReport(kind);
    setReportError(null);
    try {
      let periodLabel = activeRange.label;
      let filename = '';
      let targetOrders: OrderRecord[] = [];

      if (kind === 'daily') {
        periodLabel = dailyRefDate.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
        filename = getDailyReportFilename(dailyRefDate);
        targetOrders = dailySeries.completedOrders;
      } else if (kind === 'weekly') {
        periodLabel = weeklySeries.periodLabel;
        filename = getWeeklyReportFilename(weeklyRefDate);
        targetOrders = weeklySeries.completedOrders;
      } else if (kind === 'monthly') {
        const refMonth =
          datePreset === 'last_month'
            ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
            : new Date(now.getFullYear(), now.getMonth(), 1);
        const monthBounds = getDateRangeForPreset(
          datePreset === 'last_month' ? 'last_month' : 'this_month',
        );
        periodLabel = monthBounds.label;
        filename = getMonthlyReportFilename(refMonth);
        targetOrders = filterOrdersInRange(orders, monthBounds).filter(isRevenueOrder);
      } else {
        periodLabel = activeRange.label;
        filename = `RikZen-Custom-Report-${customStart}_to_${customEnd}.pdf`;
        targetOrders = completedInRange;
      }

      const saved = await downloadSalesReportPdf({
        reportType: kind,
        periodLabel,
        filename,
        orders: targetOrders,
      });
      onToast(`Downloaded ${saved}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to download sales report PDF.';
      console.error('[RikZen Sales Report Download Error]', err);
      setReportError(msg);
      onToast(`Report download failed: ${msg}`);
    } finally {
      setDownloadingReport(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Date Filter Bar */}
      <section className="bg-white rounded-3xl border border-neutral-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-neutral-900">Sales Analytics &amp; Reports</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Showing verified completed sales for <span className="font-bold text-neutral-800">{activeRange.label}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Completed orders only</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((preset) => {
            const active = datePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  active
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {datePreset === 'custom' && (
          <div className="pt-2 border-t border-neutral-100 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="custom-start" className="block text-[11px] font-bold text-neutral-600 mb-1">
                From Date
              </label>
              <input
                id="custom-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-mono text-neutral-800 bg-neutral-50 focus:outline-none focus:border-[#E5391B]"
              />
            </div>
            <div>
              <label htmlFor="custom-end" className="block text-[11px] font-bold text-neutral-600 mb-1">
                To Date
              </label>
              <input
                id="custom-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-mono text-neutral-800 bg-neutral-50 focus:outline-none focus:border-[#E5391B]"
              />
            </div>
            <button
              type="button"
              disabled={downloadingReport !== null}
              onClick={() => handleDownloadReport('custom')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {downloadingReport === 'custom' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              Download Custom Range PDF
            </button>
          </div>
        )}
      </section>

      {/* Period Summary KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5">
          <p className="text-xs font-semibold text-neutral-500">Completed Sales</p>
          <p className="font-mono text-2xl sm:text-3xl font-extrabold text-[#E5391B] mt-1">
            <AnimatedNumber value={rangeMetrics.totalSales} prefix="₹" />
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5">
          <p className="text-xs font-semibold text-neutral-500">Completed Orders</p>
          <p className="font-mono text-2xl sm:text-3xl font-extrabold text-neutral-900 mt-1">
            <AnimatedNumber value={rangeMetrics.totalOrders} />
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
            of {rangeMetrics.allPeriodOrders} total in period
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5">
          <p className="text-xs font-semibold text-neutral-500">Average Order Value</p>
          <p className="font-mono text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-1">
            <AnimatedNumber value={rangeMetrics.avgOrder} prefix="₹" />
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5">
          <p className="text-xs font-semibold text-neutral-500">Payment Summary</p>
          <p className="font-mono text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {rangeMetrics.paidCount} Paid ·{' '}
            <span className="text-amber-700">{rangeMetrics.pendingPayCount} Pending</span>
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
            Discounts: {formatRupees(rangeMetrics.discounts)}
          </p>
        </div>
      </div>

      {/* Interactive Daily / Weekly / Monthly Chart + PDF Report Download Bar */}
      <section className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-neutral-100 p-1 self-start">
            {(
              [
                { id: 'daily', label: 'Daily Sales' },
                { id: 'weekly', label: 'Weekly Report' },
                { id: 'monthly', label: 'Monthly Report' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveChartTab(tab.id)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  activeChartTab === tab.id
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Real PDF Sales Report Export Buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={downloadingReport !== null}
              onClick={() => handleDownloadReport('daily')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {downloadingReport === 'daily' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download Daily Report
            </button>
            <button
              type="button"
              disabled={downloadingReport !== null}
              onClick={() => handleDownloadReport('weekly')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {downloadingReport === 'weekly' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download Weekly Report
            </button>
            <button
              type="button"
              disabled={downloadingReport !== null}
              onClick={() => handleDownloadReport('monthly')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border border-neutral-300 bg-white text-neutral-900 text-xs font-bold hover:bg-neutral-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {downloadingReport === 'monthly' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download Monthly Report
            </button>
          </div>
        </div>

        {reportError && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-red-800 inline-flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {reportError}
            </p>
            <button
              type="button"
              onClick={() => handleDownloadReport(activeChartTab)}
              className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Download
            </button>
          </div>
        )}

        {/* DAILY CHART */}
        {activeChartTab === 'daily' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-neutral-900">
                  Daily Sales ({dailyRefDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})
                </h3>
                <p className="text-xs text-neutral-500">
                  Real completed revenue grouped by order hour
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <p className="text-lg font-extrabold text-neutral-900">
                  {formatRupees(dailySeries.totalSales)}
                </p>
                <p className="text-xs text-neutral-500">
                  {dailySeries.totalOrders} completed · Avg {formatRupees(dailySeries.avgOrderValue)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Today&apos;s Sales</span>
                <span className="font-mono font-extrabold text-[#E5391B] text-sm">
                  {formatRupees(dailySeries.totalSales)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Today&apos;s Orders</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {dailySeries.allDayOrdersCount}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Avg Order Value</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {formatRupees(dailySeries.avgOrderValue)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Completed</span>
                <span className="font-mono font-extrabold text-emerald-700 text-sm">
                  {dailySeries.totalOrders}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Cancelled</span>
                <span className="font-mono font-extrabold text-red-700 text-sm">
                  {dailySeries.cancelledOrdersCount}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Best-Selling Item</span>
                <span className="font-bold text-neutral-900 text-sm truncate block" title={dailySeries.bestSellingItem?.name || ''}>
                  {dailySeries.bestSellingItem
                    ? `${dailySeries.bestSellingItem.name} (${dailySeries.bestSellingItem.qty})`
                    : '—'}
                </span>
              </div>
            </div>

            <AnimatedSalesBarChart
              buckets={dailySeries.buckets}
              emptyMessage="Complete an order to see real hourly sales appear live."
            />
          </div>
        )}

        {/* WEEKLY CHART */}
        {activeChartTab === 'weekly' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-neutral-900">
                  Weekly Sales ({weeklySeries.periodLabel})
                </h3>
                <p className="text-xs text-neutral-500">Monday to Sunday verified completed orders</p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <p className="text-lg font-extrabold text-neutral-900">
                  {formatRupees(weeklySeries.totalSales)}
                </p>
                <p className="text-xs text-neutral-500">
                  {weeklySeries.totalOrders} completed · Avg {formatRupees(weeklySeries.avgOrderValue)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Total Sales</span>
                <span className="font-mono font-extrabold text-[#E5391B] text-sm">
                  {formatRupees(weeklySeries.totalSales)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Total Orders</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {weeklySeries.totalOrders}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Avg Order Value</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {formatRupees(weeklySeries.avgOrderValue)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Best Sales Day</span>
                <span className="font-mono font-extrabold text-[#E5391B] text-sm">
                  {weeklySeries.bestDay
                    ? `${weeklySeries.bestDay.label} (${formatRupees(weeklySeries.bestDay.sales)})`
                    : '—'}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3 col-span-2 sm:col-span-1">
                <span className="text-neutral-500 block">Best-Selling Food</span>
                <span className="font-bold text-neutral-900 text-sm truncate block" title={weeklySeries.bestSellingItem?.name || ''}>
                  {weeklySeries.bestSellingItem
                    ? `${weeklySeries.bestSellingItem.name} (${weeklySeries.bestSellingItem.qty})`
                    : '—'}
                </span>
              </div>
            </div>

            <AnimatedSalesBarChart
              buckets={weeklySeries.buckets}
              highlightLabel={weeklySeries.bestDay?.label ?? null}
              emptyMessage="No completed orders recorded this week yet."
            />
          </div>
        )}

        {/* MONTHLY CHART */}
        {activeChartTab === 'monthly' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-neutral-900">
                  Monthly Sales ({now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} &amp; {now.getFullYear()})
                </h3>
                <p className="text-xs text-neutral-500">January – December completed order totals</p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <p className="text-lg font-extrabold text-neutral-900">
                  {formatRupees(monthlySeries.totalSales)}
                </p>
                <p className="text-xs text-neutral-500">
                  {now.getFullYear()} total · {monthlySeries.totalOrders} completed
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Monthly Sales</span>
                <span className="font-mono font-extrabold text-[#E5391B] text-sm">
                  {formatRupees(monthlySeries.currentMonthSales)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Total Orders</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {monthlySeries.currentMonthOrders.length}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Avg Order Value</span>
                <span className="font-mono font-extrabold text-neutral-900 text-sm">
                  {formatRupees(
                    monthlySeries.currentMonthOrders.length > 0
                      ? Math.round(
                          monthlySeries.currentMonthSales / monthlySeries.currentMonthOrders.length,
                        )
                      : 0,
                  )}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Total Discounts</span>
                <span className="font-mono font-extrabold text-emerald-700 text-sm">
                  {formatRupees(monthlySeries.currentMonthDiscounts)}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Best Sales Day</span>
                <span className="font-mono font-extrabold text-[#E5391B] text-sm truncate block">
                  {monthlySeries.currentMonthBestDay
                    ? `${monthlySeries.currentMonthBestDay.dateLabel} (${formatRupees(monthlySeries.currentMonthBestDay.sales)})`
                    : '—'}
                </span>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200/70 p-3">
                <span className="text-neutral-500 block">Best-Selling Item</span>
                <span className="font-bold text-neutral-900 text-sm truncate block" title={monthlySeries.currentMonthBestItem?.name || ''}>
                  {monthlySeries.currentMonthBestItem
                    ? `${monthlySeries.currentMonthBestItem.name} (${monthlySeries.currentMonthBestItem.qty})`
                    : '—'}
                </span>
              </div>
            </div>

            <AnimatedSalesBarChart
              buckets={monthlySeries.buckets}
              highlightLabel={monthlySeries.buckets[now.getMonth()]?.label ?? null}
              emptyMessage={`No completed orders recorded in ${now.getFullYear()} yet.`}
            />
          </div>
        )}
      </section>

      {/* Top Selling Dishes (Completed Orders Only) */}
      {rangeMetrics.topDishes.length > 0 && (
        <section className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-3">
          <h3 className="text-base font-extrabold text-neutral-900">
            Top Selling Items ({activeRange.label})
          </h3>
          <div className="divide-y divide-neutral-100 tabular-nums">
            {rangeMetrics.topDishes.map((dish) => (
              <div key={dish.name} className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-semibold text-neutral-800">{dish.name}</span>
                <span className="font-mono text-neutral-600">
                  {dish.qty} sold ·{' '}
                  <strong className="text-neutral-900">{formatRupees(dish.revenue)}</strong>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full Searchable Order History with Row Actions: VIEW | DOWNLOAD BILL | SEND BILL */}
      <section className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-neutral-900">Order History</h3>
            <p className="text-xs text-neutral-500">
              {filteredHistory.length} {filteredHistory.length === 1 ? 'order' : 'orders'} matching{' '}
              {activeRange.label}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search #RK, customer name, mobile..."
              className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-neutral-50 border border-neutral-200 text-sm focus:outline-none focus:border-[#E5391B]"
            />
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="py-10 text-center space-y-1">
            <Calendar className="w-7 h-7 text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-neutral-800">No matching orders found</p>
            <p className="text-xs text-neutral-500">
              Try switching the date filter or clearing your search query.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-semibold text-neutral-500">
                    <th className="py-2.5 pr-3">Order</th>
                    <th className="py-2.5 pr-3">Customer</th>
                    <th className="py-2.5 pr-3">Table</th>
                    <th className="py-2.5 pr-3">Items</th>
                    <th className="py-2.5 pr-3 text-right">Total</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 pr-3">Date</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredHistory.map((ord) => {
                    const { date, time } = formatOrderDate(ord.created_at);
                    const isBusySend =
                      sendingWaOrderId === ord.id ||
                      ord.whatsapp_status === 'sending' ||
                      ord.whatsapp_status === 'retrying';
                    const isDownloading = downloadingBillId === ord.id;
                    const itemSummary = ord.items
                      .map((l) => `${l.name} ×${l.quantity}`)
                      .join(', ');

                    return (
                      <tr key={ord.id} className="hover:bg-neutral-50/70">
                        <td className="py-3 pr-3 font-mono font-bold text-[#E5391B] whitespace-nowrap">
                          #{ord.order_code}
                        </td>
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-neutral-900 truncate max-w-[160px]">
                            {ord.customer_name}
                          </p>
                          <p className="text-xs font-mono text-neutral-500">
                            {formatIndianMobileDisplay(ord.customer_mobile)}
                          </p>
                        </td>
                        <td className="py-3 pr-3 font-medium whitespace-nowrap">
                          Table {ord.table_number}
                        </td>
                        <td className="py-3 pr-3 text-xs text-neutral-600 max-w-[200px] truncate" title={itemSummary}>
                          {ord.item_count} {ord.item_count === 1 ? 'item' : 'items'} · {itemSummary}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono font-bold text-neutral-900 whitespace-nowrap">
                          {formatRupees(ord.total)}
                        </td>
                        <td className="py-3 pr-3 text-xs font-bold whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span
                              className={`block capitalize ${
                                ord.status === 'completed'
                                  ? 'text-emerald-700'
                                  : ord.status === 'rejected'
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              {ord.status.replace('_', ' ')}
                            </span>
                            {ord.status !== 'rejected' && (
                              <span
                                className={`block text-[11px] ${
                                  ord.payment_status === 'paid'
                                    ? 'text-emerald-700'
                                    : ord.payment_status === 'failed'
                                      ? 'text-red-700'
                                      : 'text-amber-700'
                                }`}
                              >
                                {ord.payment_status === 'paid'
                                  ? 'Payment: Paid'
                                  : ord.payment_status === 'failed'
                                    ? 'Payment: Failed'
                                    : 'Payment: Pending'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-xs text-neutral-500 whitespace-nowrap">
                          <div>{date}</div>
                          <div className="text-[11px]">{time}</div>
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!ord.pdf_ready && !ord.pdf_url && ord.bill_status === 'not_generated' ? (
                              <button
                                type="button"
                                onClick={() => onViewOrder(ord)}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#E5391B] text-white text-xs font-bold hover:bg-[#C82E14] inline-flex items-center gap-1 cursor-pointer"
                              >
                                Generate Bill
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onViewOrder(ord)}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg border border-neutral-200 bg-white text-neutral-800 text-xs font-bold hover:bg-neutral-100 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  View
                                </button>
                                <button
                                  type="button"
                                  disabled={isDownloading}
                                  onClick={() => onDownloadBill(ord)}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  {isDownloading ? '...' : 'Download'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusySend}
                                  onClick={() => onSendWhatsApp(ord)}
                                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60 ${
                                    ord.whatsapp_status === 'failed'
                                      ? 'bg-red-700 hover:bg-red-800'
                                      : 'bg-emerald-700 hover:bg-emerald-800'
                                  }`}
                                >
                                  {isBusySend ? (
                                    <Clock className="w-3.5 h-3.5" />
                                  ) : ord.whatsapp_status === 'failed' ? (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  ) : (
                                    <Send className="w-3.5 h-3.5" />
                                  )}
                                  {ord.whatsapp_status === 'failed'
                                    ? 'Retry'
                                    : ord.whatsapp_status === 'sent'
                                      ? 'Sent'
                                      : 'Share Bill'}
                                </button>
                              </>
                            )}
                            {onMarkPaid && ord.payment_status !== 'paid' && ord.status !== 'rejected' && (
                              <button
                                type="button"
                                disabled={updatingPaymentId === ord.id}
                                onClick={() => onMarkPaid(ord)}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold hover:bg-emerald-100 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {updatingPaymentId === ord.id ? '...' : 'Mark Paid'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Order History Cards */}
            <div className="md:hidden space-y-3">
              {filteredHistory.map((ord) => {
                const { date, time } = formatOrderDate(ord.created_at);
                const isBusySend =
                  sendingWaOrderId === ord.id ||
                  ord.whatsapp_status === 'sending' ||
                  ord.whatsapp_status === 'retrying';
                const isDownloading = downloadingBillId === ord.id;

                return (
                  <div
                    key={ord.id}
                    className="rounded-2xl border border-neutral-200 p-4 space-y-3 bg-neutral-50/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-bold text-[#E5391B]">
                          #{ord.order_code} · Table {ord.table_number}
                        </p>
                        <p className="font-bold text-neutral-900 truncate">{ord.customer_name}</p>
                        <p className="text-xs font-mono text-neutral-500">
                          {formatIndianMobileDisplay(ord.customer_mobile)}
                        </p>
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        <p className="font-mono text-base font-extrabold text-neutral-900">
                          {formatRupees(ord.total)}
                        </p>
                        <p
                          className={`text-[11px] font-bold capitalize ${
                            ord.status === 'completed'
                              ? 'text-emerald-700'
                              : ord.status === 'rejected'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {ord.status.replace('_', ' ')}
                        </p>
                        {ord.status !== 'rejected' && (
                          <p
                            className={`text-[11px] font-bold ${
                              ord.payment_status === 'paid'
                                ? 'text-emerald-700'
                                : ord.payment_status === 'failed'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {ord.payment_status === 'paid'
                              ? 'Paid'
                              : ord.payment_status === 'failed'
                                ? 'Pay Failed'
                                : 'Pay Pending'}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-neutral-600">
                      {ord.items.map((l) => `${l.name} ×${l.quantity}`).join(', ')} · {date}, {time}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {!ord.pdf_ready && !ord.pdf_url && ord.bill_status === 'not_generated' ? (
                        <button
                          type="button"
                          onClick={() => onViewOrder(ord)}
                          className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl bg-[#E5391B] text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          Generate Bill
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onViewOrder(ord)}
                            className="flex-1 min-h-[38px] px-2 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-900 text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                          <button
                            type="button"
                            disabled={isDownloading}
                            onClick={() => onDownloadBill(ord)}
                            className="flex-1 min-h-[38px] px-2 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {isDownloading ? '...' : 'Download'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusySend}
                            onClick={() => onSendWhatsApp(ord)}
                            className={`flex-1 min-h-[38px] px-2 py-1.5 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 ${
                              ord.whatsapp_status === 'failed' ? 'bg-red-700' : 'bg-emerald-700'
                            }`}
                          >
                            <Send className="w-3.5 h-3.5" />
                            {ord.whatsapp_status === 'failed'
                              ? 'Retry'
                              : ord.whatsapp_status === 'sent'
                                ? 'Sent'
                                : 'Share Bill'}
                          </button>
                        </>
                      )}
                      {onMarkPaid && ord.payment_status !== 'paid' && ord.status !== 'rejected' && (
                        <button
                          type="button"
                          disabled={updatingPaymentId === ord.id}
                          onClick={() => onMarkPaid(ord)}
                          className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {updatingPaymentId === ord.id ? 'Updating...' : 'Mark Paid'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
};
