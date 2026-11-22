import fs from 'node:fs';
import PDFDocument from 'pdfkit';

export interface SalesReportOrderRow {
  order_code: string;
  customer_name: string;
  table_number: number;
  total: number;
  status: string;
  created_at_iso: string;
}

export interface SalesReportPdfInput {
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  periodLabel: string;
  orders: SalesReportOrderRow[];
  generatedAtIso: string;
}

const DEJAVU_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const DEJAVU_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function drawSmallBurger(doc: PDFKit.PDFDocument, x: number, y: number, scale = 0.8) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#F59E0B').path('M 4 16 C 4 6, 28 6, 28 16 Z').fill();
  doc.fillColor('#22C55E').roundedRect(3, 16.5, 26, 3, 1.5).fill();
  doc.fillColor('#7C2D12').roundedRect(4, 20, 24, 4, 2).fill();
  doc.fillColor('#D97706').roundedRect(4, 24.5, 24, 4.5, 2).fill();
  doc.restore();
}

function drawSmallPizza(doc: PDFKit.PDFDocument, x: number, y: number, scale = 0.8) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#FACC15').moveTo(4, 6).lineTo(28, 6).lineTo(16, 30).closePath().fill();
  doc.fillColor('#D97706').roundedRect(3, 4, 26, 4.5, 2).fill();
  doc.fillColor('#DC2626').circle(13, 13, 2.2).fill();
  doc.fillColor('#DC2626').circle(20, 14, 2.0).fill();
  doc.fillColor('#DC2626').circle(16, 21, 2.1).fill();
  doc.restore();
}

function drawSmallFries(doc: PDFKit.PDFDocument, x: number, y: number, scale = 0.8) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#FACC15').roundedRect(7, 4, 3.2, 13, 1).fill();
  doc.fillColor('#FDE047').roundedRect(11.5, 2, 3.2, 15, 1).fill();
  doc.fillColor('#F59E0B').roundedRect(16, 3, 3.2, 14, 1).fill();
  doc.fillColor('#FACC15').roundedRect(20.5, 5, 3.2, 12, 1).fill();
  doc.fillColor('#E5391B').moveTo(5, 13).lineTo(27, 13).lineTo(24, 29).lineTo(8, 29).closePath().fill();
  doc.restore();
}

function drawSmallRoll(doc: PDFKit.PDFDocument, x: number, y: number, scale = 0.8) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.rotate(-22, { origin: [16, 16] });
  doc.fillColor('#FDE68A').roundedRect(9, 4, 14, 24, 6).fill();
  doc.fillColor('#FFFFFF').roundedRect(9, 16, 14, 12, 5).fill();
  doc.fillColor('#DC2626').circle(16, 7, 2.2).fill();
  doc.fillColor('#22C55E').circle(13, 8, 1.8).fill();
  doc.restore();
}

function drawReportFrame(doc: PDFKit.PDFDocument) {
  doc
    .roundedRect(18, 18, doc.page.width - 36, doc.page.height - 36, 12)
    .lineWidth(0.8)
    .strokeColor('#E5E7EB')
    .stroke();
}

/**
 * Generates a real server-side Sales Report PDF for RikZen Fast Food.
 * Strictly counts ONLY completed/paid orders toward Total Sales revenue.
 */
export async function generateSalesReportPdfBuffer(input: SalesReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: {
        Title: `RikZen Fast Food Sales Report - ${input.periodLabel}`,
        Author: 'RikZen Fast Food',
        Subject: `${input.reportType.toUpperCase()} Sales Report`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hasDejaVu = fs.existsSync(DEJAVU_REGULAR) && fs.existsSync(DEJAVU_BOLD);
    if (hasDejaVu) {
      doc.registerFont('Body', DEJAVU_REGULAR);
      doc.registerFont('Bold', DEJAVU_BOLD);
    }
    const fontBody = hasDejaVu ? 'Body' : 'Helvetica';
    const fontBold = hasDejaVu ? 'Bold' : 'Helvetica-Bold';
    const currency = hasDejaVu ? '₹' : 'Rs.';
    const fmt = (val: number) => `${currency}${Math.round(val).toLocaleString('en-IN')}`;

    // Strict Revenue Rule: Only completed/paid orders count as revenue
    const completedOrders = input.orders.filter((o) => o.status === 'completed');
    const totalOrders = completedOrders.length;
    const totalSales = completedOrders.reduce((sum, o) => sum + Math.max(0, Number(o.total || 0)), 0);
    const averageOrder = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 36;
    const contentWidth = pageWidth - left * 2;

    drawReportFrame(doc);

    // Header Banner
    doc
      .roundedRect(left, 34, contentWidth, 80, 12)
      .fillColor('#151110')
      .fill();

    drawSmallBurger(doc, left + 16, 56, 0.9);
    drawSmallFries(doc, left + 48, 56, 0.85);
    drawSmallPizza(doc, left + contentWidth - 44, 56, 0.9);
    drawSmallRoll(doc, left + contentWidth - 76, 58, 0.85);

    doc
      .font(fontBold)
      .fontSize(20)
      .fillColor('#FFFFFF')
      .text('RIKZEN FAST FOOD', left, 48, { width: contentWidth, align: 'center' });

    const typeTitle =
      input.reportType === 'daily'
        ? 'Daily Sales Report'
        : input.reportType === 'weekly'
          ? 'Weekly Sales Report'
          : input.reportType === 'monthly'
            ? 'Monthly Sales Report'
            : 'Sales Report';

    doc
      .font(fontBody)
      .fontSize(10.5)
      .fillColor('#FDBA74')
      .text(`${typeTitle}  •  Period: ${input.periodLabel}`, left, 76, {
        width: contentWidth,
        align: 'center',
      });

    // Summary Metrics Row (3 clean cards)
    const cardsTop = 130;
    const gap = 12;
    const cardW = (contentWidth - gap * 2) / 3;
    const metrics = [
      { label: 'Total Completed Orders', value: String(totalOrders), accent: '#111827' },
      { label: 'Total Sales (Completed)', value: fmt(totalSales), accent: '#E5391B' },
      { label: 'Average Order Value', value: fmt(averageOrder), accent: '#15803D' },
    ];

    metrics.forEach((m, idx) => {
      const cx = left + idx * (cardW + gap);
      doc
        .roundedRect(cx, cardsTop, cardW, 62, 10)
        .fillColor('#F9FAFB')
        .fill();
      doc
        .roundedRect(cx, cardsTop, cardW, 62, 10)
        .lineWidth(0.8)
        .strokeColor('#E5E7EB')
        .stroke();

      doc
        .font(fontBody)
        .fontSize(8.5)
        .fillColor('#6B7280')
        .text(m.label, cx + 12, cardsTop + 12, { width: cardW - 24 });
      doc
        .font(fontBold)
        .fontSize(17)
        .fillColor(m.accent)
        .text(m.value, cx + 12, cardsTop + 30, { width: cardW - 24 });
    });

    // Order Summary Section
    let y = 212;
    doc
      .font(fontBold)
      .fontSize(11)
      .fillColor('#111827')
      .text('ORDER SUMMARY (VERIFIED COMPLETED ORDERS)', left, y);
    y += 18;

    const colOrderX = left + 10;
    const colCustX = left + 86;
    const colTableX = left + 228;
    const colAmountX = left + 286;
    const colDateX = left + 358;
    const colStatusX = left + 452;

    const drawTableHeader = (topY: number) => {
      doc
        .roundedRect(left, topY, contentWidth, 24, 6)
        .fillColor('#FEF2F0')
        .fill();
      doc.font(fontBold).fontSize(8.5).fillColor('#991B1B');
      doc.text('Order No', colOrderX, topY + 7, { width: 72 });
      doc.text('Customer', colCustX, topY + 7, { width: 136 });
      doc.text('Table', colTableX, topY + 7, { width: 52 });
      doc.text('Amount', colAmountX, topY + 7, { width: 64, align: 'right' });
      doc.text('Date', colDateX, topY + 7, { width: 88 });
      doc.text('Status', colStatusX, topY + 7, { width: 64, align: 'right' });
      return topY + 30;
    };

    y = drawTableHeader(y);

    if (completedOrders.length === 0) {
      doc
        .roundedRect(left, y, contentWidth, 56, 8)
        .fillColor('#F9FAFB')
        .fill();
      doc
        .font(fontBody)
        .fontSize(9.5)
        .fillColor('#6B7280')
        .text(
          'No completed orders recorded in this period yet.',
          left,
          y + 22,
          { width: contentWidth, align: 'center' },
        );
      y += 70;
    } else {
      for (const row of completedOrders) {
        if (y > pageHeight - 130) {
          doc.addPage();
          drawReportFrame(doc);
          y = drawTableHeader(36);
        }

        const d = new Date(row.created_at_iso || Date.now());
        const dateLabel = d.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        });

        doc.font(fontBold).fontSize(8.8).fillColor('#E5391B');
        doc.text(`#${row.order_code}`, colOrderX, y, { width: 72 });

        doc.font(fontBold).fontSize(8.8).fillColor('#111827');
        doc.text(row.customer_name || 'Guest', colCustX, y, { width: 136, ellipsis: true });

        doc.font(fontBody).fontSize(8.8).fillColor('#374151');
        doc.text(`Table ${row.table_number}`, colTableX, y, { width: 52 });

        doc.font(fontBold).fontSize(8.8).fillColor('#111827');
        doc.text(fmt(row.total), colAmountX, y, { width: 64, align: 'right' });

        doc.font(fontBody).fontSize(8.2).fillColor('#4B5563');
        doc.text(dateLabel, colDateX, y, { width: 92 });

        doc.font(fontBold).fontSize(8.2).fillColor('#15803D');
        doc.text('Completed', colStatusX, y, { width: 64, align: 'right' });

        y += 18;
        doc
          .moveTo(left + 6, y)
          .lineTo(left + contentWidth - 6, y)
          .lineWidth(0.5)
          .strokeColor('#E5E7EB')
          .stroke();
        y += 7;
      }
    }

    // Ensure totals & footer fit cleanly
    if (y > pageHeight - 125) {
      doc.addPage();
      drawReportFrame(doc);
      y = 48;
    }

    // Bottom Total Sales Banner
    y += 8;
    doc
      .roundedRect(left, y, contentWidth, 38, 10)
      .fillColor('#E5391B')
      .fill();

    doc
      .font(fontBold)
      .fontSize(12)
      .fillColor('#FFFFFF')
      .text(`TOTAL SALES (${totalOrders} COMPLETED ORDERS)`, left + 16, y + 12, {
        width: contentWidth - 150,
      });

    doc
      .font(fontBold)
      .fontSize(15)
      .fillColor('#FFFFFF')
      .text(fmt(totalSales), left + contentWidth - 136, y + 10, {
        width: 120,
        align: 'right',
      });

    // Footer
    const footerY = pageHeight - 76;
    doc
      .moveTo(left, footerY)
      .lineTo(left + contentWidth, footerY)
      .lineWidth(0.7)
      .strokeColor('#E5E7EB')
      .stroke();

    const genDate = new Date(input.generatedAtIso || Date.now()).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    doc
      .font(fontBold)
      .fontSize(9.5)
      .fillColor('#111827')
      .text('RikZen Fast Food — Thank you.', left, footerY + 12, {
        width: contentWidth,
        align: 'center',
      });
    doc
      .font(fontBody)
      .fontSize(8)
      .fillColor('#6B7280')
      .text(`Generated on ${genDate} IST • Only verified completed orders are included in revenue.`, left, footerY + 28, {
        width: contentWidth,
        align: 'center',
      });

    doc.end();
  });
}
