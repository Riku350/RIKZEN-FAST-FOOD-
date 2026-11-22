import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { OrderRecord, PaymentQrSnapshot } from '../types/restaurant';

function formatRs(amount: number): string {
  return `Rs. ${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
}

function formatDateTime(ts: unknown): { date: string; time: string } {
  let d = new Date();
  if (ts instanceof Date && !Number.isNaN(ts.getTime())) {
    d = ts;
  } else if (typeof ts === 'string' && ts.trim()) {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  } else if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    d = (ts as { toDate: () => Date }).toDate();
  }
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = (blob.type || '').toLowerCase();
    const format: 'PNG' | 'JPEG' | null = mime.includes('png')
      ? 'PNG'
      : mime.includes('jpeg') || mime.includes('jpg')
        ? 'JPEG'
        : null;
    if (!format) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to encode QR image'));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, format };
  } catch {
    return null;
  }
}

/**
 * Generates a real, valid, standards-compliant `%PDF-` Customer Bill directly in the browser
 * when Express server PDF generation is unavailable (e.g. static Netlify deployments).
 */
export async function generateClientBillPdfBlob(
  order: Pick<
    OrderRecord,
    | 'order_code'
    | 'order_number'
    | 'table_number'
    | 'customer_name'
    | 'customer_mobile'
    | 'items'
    | 'subtotal'
    | 'discount'
    | 'total'
    | 'notes'
    | 'payment_status'
    | 'created_at'
  >,
  snapshot: PaymentQrSnapshot | null,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const orderCode = (order.order_code || `RK${order.order_number || 1000}`).toUpperCase();
  const { date, time } = formatDateTime(order.created_at);

  // Top Header Banner
  doc.setFillColor(21, 17, 16);
  doc.roundedRect(margin, 36, contentWidth, 74, 10, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('RIKZEN FAST FOOD', margin + 20, 68);
  doc.setTextColor(253, 186, 116);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Fresh  •  Fast  •  Delicious  •  Official Customer Bill', margin + 20, 90);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`#${orderCode}`, pageWidth - margin - 20, 68, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Table ${order.table_number}`, pageWidth - margin - 20, 90, { align: 'right' });

  // Customer & Order Metadata Box
  let y = 128;
  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(229, 231, 235);
  doc.roundedRect(margin, y, contentWidth, 74, 8, 8, 'FD');

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Customer Name:', margin + 14, y + 22);
  doc.text('Customer Mobile:', margin + 14, y + 40);
  doc.text('Table Number:', margin + 14, y + 58);

  doc.setFont('helvetica', 'normal');
  doc.text(order.customer_name || 'Guest', margin + 112, y + 22);
  doc.text(order.customer_mobile || '-', margin + 112, y + 40);
  doc.text(`Table ${order.table_number}`, margin + 112, y + 58);

  const rightColX = margin + contentWidth / 2 + 12;
  doc.setFont('helvetica', 'bold');
  doc.text('Order Number:', rightColX, y + 22);
  doc.text('Date:', rightColX, y + 40);
  doc.text('Time:', rightColX, y + 58);

  doc.setFont('helvetica', 'normal');
  doc.text(`#${orderCode}`, rightColX + 92, y + 22);
  doc.text(date, rightColX + 92, y + 40);
  doc.text(time, rightColX + 92, y + 58);

  // Order Items Table
  y += 96;
  doc.setFillColor(229, 57, 27);
  doc.roundedRect(margin, y, contentWidth, 26, 5, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Item Name', margin + 12, y + 17);
  doc.text('Qty', margin + contentWidth - 190, y + 17, { align: 'right' });
  doc.text('Price', margin + contentWidth - 105, y + 17, { align: 'right' });
  doc.text('Total', margin + contentWidth - 12, y + 17, { align: 'right' });

  y += 30;
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  for (const item of order.items) {
    if (y > 680) {
      doc.addPage();
      y = 56;
    }
    const cleanName = String(item.name || 'Item').slice(0, 44);
    doc.text(cleanName, margin + 12, y + 14);
    doc.text(String(item.quantity), margin + contentWidth - 190, y + 14, { align: 'right' });
    doc.text(formatRs(item.unit_price), margin + contentWidth - 105, y + 14, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(formatRs(item.line_total), margin + contentWidth - 12, y + 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(243, 244, 246);
    doc.line(margin, y + 22, margin + contentWidth, y + 22);
    y += 26;
  }

  // Totals Summary
  y += 12;
  doc.setDrawColor(209, 213, 219);
  doc.line(margin + contentWidth - 230, y, margin + contentWidth, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text('Subtotal', margin + contentWidth - 220, y);
  doc.text(formatRs(order.subtotal), margin + contentWidth - 12, y, { align: 'right' });

  if ((order.discount || 0) > 0) {
    y += 18;
    doc.setTextColor(5, 150, 105);
    doc.text('Discount', margin + contentWidth - 220, y);
    doc.text(`- ${formatRs(order.discount)}`, margin + contentWidth - 12, y, { align: 'right' });
  }

  y += 24;
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(margin + contentWidth - 232, y - 16, 232, 30, 6, 6, 'F');
  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Final Total', margin + contentWidth - 220, y + 4);
  doc.setTextColor(229, 57, 27);
  doc.text(formatRs(order.total), margin + contentWidth - 12, y + 4, { align: 'right' });

  y += 26;
  const isPaid = order.payment_status === 'paid';
  doc.setFontSize(9.5);
  doc.setTextColor(isPaid ? 5 : 180, isPaid ? 150 : 83, isPaid ? 105 : 9);
  doc.text(
    isPaid ? 'Payment Status: PAID' : 'Payment Status: Pending',
    margin + contentWidth - 12,
    y,
    { align: 'right' },
  );

  // Honest 2-Mode Payment QR Section
  if (snapshot && (snapshot.upi_uri || snapshot.qr_image_url)) {
    y += 20;
    if (y > 610) {
      doc.addPage();
      y = 56;
    }

    let qrDataUrl: string | null = null;
    let qrFormat: 'PNG' | 'JPEG' = 'PNG';
    let qrCaption = '';

    if (snapshot.mode === 'dynamic_upi' && snapshot.upi_uri) {
      try {
        qrDataUrl = await QRCode.toDataURL(snapshot.upi_uri, {
          width: 360,
          margin: 2,
          errorCorrectionLevel: 'H',
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        qrCaption = `Scan to Pay Exact ${formatRs(order.total)} (${snapshot.upi_id})`;
      } catch {
        qrDataUrl = null;
      }
    } else if (snapshot.qr_image_url) {
      const loaded = await fetchImageAsDataUrl(snapshot.qr_image_url);
      if (loaded) {
        qrDataUrl = loaded.dataUrl;
        qrFormat = loaded.format;
        qrCaption = `Scan & Enter ${formatRs(order.total)} in your UPI app`;
      }
    }

    if (qrDataUrl) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(209, 213, 219);
      doc.roundedRect(margin, y, contentWidth, 162, 10, 10, 'FD');

      doc.setTextColor(17, 24, 39);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('SCAN & PAY VIA UPI', margin + 16, y + 24);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(75, 85, 99);
      doc.text(snapshot.merchant_name || 'RikZen Fast Food', margin + 16, y + 42);
      doc.text(qrCaption, margin + 16, y + 60);
      doc.text('PhonePe  •  Google Pay  •  Paytm  •  BHIM', margin + 16, y + 80);

      doc.addImage(qrDataUrl, qrFormat, margin + contentWidth - 146, y + 16, 130, 130);
      y += 176;
    }
  }

  // Footer Thank You Message
  const footerY = Math.min(786, Math.max(y + 28, 720));
  doc.setDrawColor(229, 231, 235);
  doc.line(margin, footerY - 18, margin + contentWidth, footerY - 18);
  doc.setTextColor(229, 57, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Thank You for visiting RikZen Fast Food!', pageWidth / 2, footerY, {
    align: 'center',
  });
  doc.setTextColor(107, 114, 128);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('We hope to serve you again soon.', pageWidth / 2, footerY + 15, {
    align: 'center',
  });

  return doc.output('blob');
}

/**
 * Generates a real, valid `%PDF-` Sales Report directly in the browser when Express server
 * PDF generation is unavailable (e.g. static Netlify deployments).
 */
export function generateClientSalesReportPdfBlob(params: {
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  periodLabel: string;
  orders: Array<{
    order_code: string;
    customer_name: string;
    table_number: number;
    total: number;
    created_at_iso: string;
  }>;
}): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;

  const totalRevenue = params.orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const avgOrder = params.orders.length > 0 ? Math.round(totalRevenue / params.orders.length) : 0;

  doc.setFillColor(21, 17, 16);
  doc.roundedRect(margin, 36, contentWidth, 68, 10, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RIKZEN FAST FOOD — SALES REPORT', margin + 18, 66);
  doc.setTextColor(253, 186, 116);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${params.reportType.toUpperCase()} REPORT  •  ${params.periodLabel}`, margin + 18, 86);

  let y = 124;
  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(229, 231, 235);
  doc.roundedRect(margin, y, contentWidth, 54, 8, 8, 'FD');

  doc.setTextColor(17, 24, 39);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Completed Orders: ${params.orders.length}`, margin + 16, y + 24);
  doc.text(`Total Revenue: ${formatRs(totalRevenue)}`, margin + 190, y + 24);
  doc.text(`Average Bill: ${formatRs(avgOrder)}`, margin + 380, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin + 16, y + 42);

  y += 74;
  doc.setFillColor(229, 57, 27);
  doc.roundedRect(margin, y, contentWidth, 24, 5, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Order #', margin + 10, y + 15);
  doc.text('Customer', margin + 95, y + 15);
  doc.text('Table', margin + 275, y + 15);
  doc.text('Date / Time', margin + 330, y + 15);
  doc.text('Total', margin + contentWidth - 10, y + 15, { align: 'right' });

  y += 28;
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  for (const ord of params.orders) {
    if (y > 760) {
      doc.addPage();
      y = 52;
    }
    const dt = formatDateTime(ord.created_at_iso);
    doc.text(`#${ord.order_code}`, margin + 10, y + 12);
    doc.text((ord.customer_name || 'Guest').slice(0, 28), margin + 95, y + 12);
    doc.text(`T${ord.table_number}`, margin + 275, y + 12);
    doc.text(`${dt.date} ${dt.time}`, margin + 330, y + 12);
    doc.setFont('helvetica', 'bold');
    doc.text(formatRs(ord.total), margin + contentWidth - 10, y + 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(243, 244, 246);
    doc.line(margin, y + 18, margin + contentWidth, y + 18);
    y += 22;
  }

  return doc.output('blob');
}
