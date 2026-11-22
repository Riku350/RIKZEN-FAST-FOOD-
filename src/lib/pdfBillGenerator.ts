import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import type { OrderLineItem } from '../types/restaurant.ts';

export interface BillPdfInput {
  order_code: string;
  table_number: number;
  customer_name: string;
  customer_mobile: string;
  items: OrderLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  notes?: string;
  created_at_iso: string;
}

const DEJAVU_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const DEJAVU_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function formatMobileDisplay(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return mobile || 'Not provided';
}

function drawVectorBurger(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#F59E0B').path('M 4 16 C 4 6, 28 6, 28 16 Z').fill();
  doc.fillColor('#22C55E').roundedRect(3, 16.5, 26, 3, 1.5).fill();
  doc.fillColor('#7C2D12').roundedRect(4, 20, 24, 4, 2).fill();
  doc.fillColor('#D97706').roundedRect(4, 24.5, 24, 4.5, 2).fill();
  doc.restore();
}

function drawVectorPizza(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#FACC15').moveTo(4, 6).lineTo(28, 6).lineTo(16, 30).closePath().fill();
  doc.fillColor('#D97706').roundedRect(3, 4, 26, 4.5, 2).fill();
  doc.fillColor('#DC2626').circle(13, 13, 2.3).fill();
  doc.fillColor('#DC2626').circle(20, 14, 2.1).fill();
  doc.fillColor('#DC2626').circle(16, 21, 2.2).fill();
  doc.restore();
}

function drawVectorFries(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.fillColor('#FACC15').roundedRect(7, 4, 3.2, 13, 1).fill();
  doc.fillColor('#FDE047').roundedRect(11.5, 2, 3.2, 15, 1).fill();
  doc.fillColor('#F59E0B').roundedRect(16, 3, 3.2, 14, 1).fill();
  doc.fillColor('#FACC15').roundedRect(20.5, 5, 3.2, 12, 1).fill();
  doc.fillColor('#E5391B').moveTo(5, 13).lineTo(27, 13).lineTo(24, 29).lineTo(8, 29).closePath().fill();
  doc.restore();
}

function drawVectorDrink(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.strokeColor('#E5391B').lineWidth(2).moveTo(19, 2).lineTo(16, 10).stroke();
  doc.fillColor('#E5391B').moveTo(8, 10).lineTo(24, 10).lineTo(21.5, 29).lineTo(10.5, 29).closePath().fill();
  doc.fillColor('#FFFFFF').roundedRect(7, 8, 18, 3, 1.5).fill();
  doc.fillColor('#FFFFFF').rect(9.8, 16, 12.4, 4.5).fill();
  doc.restore();
}

function drawVectorRoll(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1) {
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.rotate(-22, { origin: [16, 16] });
  doc.fillColor('#FDE68A').roundedRect(9, 4, 14, 24, 6).fill();
  doc.fillColor('#FFFFFF').roundedRect(9, 16, 14, 12, 5).fill();
  doc.fillColor('#DC2626').circle(16, 7, 2.2).fill();
  doc.fillColor('#22C55E').circle(13, 8, 1.8).fill();
  doc.restore();
}

function drawPageFrame(doc: PDFKit.PDFDocument) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  doc
    .roundedRect(14, 14, pageWidth - 28, pageHeight - 28, 14)
    .lineWidth(1)
    .strokeColor('#E5E7EB')
    .stroke();
}

/**
 * Generates a real, verified, branded RikZen Fast Food PDF invoice buffer.
 * Uses DejaVuSans for crisp ₹ Rupee glyph rendering with automatic Helvetica fallback.
 */
export async function generateBrandedBillPdfBuffer(input: BillPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 28,
      info: {
        Title: `RikZen Fast Food Bill #${input.order_code}`,
        Author: 'RikZen Fast Food',
        Subject: `Order Invoice #${input.order_code}`,
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
    const fmt = (amount: number) => `${currency}${Math.round(amount).toLocaleString('en-IN')}`;

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 28;
    const contentWidth = pageWidth - left * 2;
    const footerY = pageHeight - 98;

    drawPageFrame(doc);

    // Header Banner
    doc
      .roundedRect(left, 26, contentWidth, 72, 12)
      .fillColor('#151110')
      .fill();

    drawVectorBurger(doc, left + 12, 45, 0.92);
    drawVectorPizza(doc, left + contentWidth - 42, 45, 0.92);

    doc
      .font(fontBold)
      .fontSize(17)
      .fillColor('#FFFFFF')
      .text('RIKZEN FAST FOOD', left, 41, { width: contentWidth, align: 'center' });

    doc
      .font(fontBody)
      .fontSize(8.8)
      .fillColor('#FDBA74')
      .text('Fast Food  •  Fresh  •  Delicious', left, 65, {
        width: contentWidth,
        align: 'center',
      });

    // Date & Time (IST India format)
    const createdDate = new Date(input.created_at_iso || Date.now());
    const dateStr = createdDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const timeStr = createdDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    // Customer & Order Metadata Card
    const metaTop = 110;
    doc
      .roundedRect(left, metaTop, contentWidth, 84, 10)
      .fillColor('#F9FAFB')
      .fill();
    doc
      .roundedRect(left, metaTop, contentWidth, 84, 10)
      .lineWidth(0.8)
      .strokeColor('#E5E7EB')
      .stroke();

    doc
      .font(fontBold)
      .fontSize(8)
      .fillColor('#E5391B')
      .text('CUSTOMER & ORDER DETAILS', left + 12, metaTop + 10);

    const col1X = left + 12;
    const col2X = left + Math.floor(contentWidth * 0.54);

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Customer:', col1X, metaTop + 28);
    doc
      .font(fontBold)
      .fontSize(9)
      .fillColor('#111827')
      .text(input.customer_name || 'Guest', col1X + 48, metaTop + 27, {
        width: col2X - col1X - 54,
        ellipsis: true,
      });

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Mobile:', col1X, metaTop + 45);
    doc
      .font(fontBold)
      .fontSize(8.8)
      .fillColor('#111827')
      .text(formatMobileDisplay(input.customer_mobile), col1X + 48, metaTop + 45, {
        width: col2X - col1X - 54,
      });

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Table:', col1X, metaTop + 62);
    doc
      .font(fontBold)
      .fontSize(9)
      .fillColor('#111827')
      .text(`Table ${input.table_number}`, col1X + 48, metaTop + 62);

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Order No:', col2X, metaTop + 28);
    doc
      .font(fontBold)
      .fontSize(9.5)
      .fillColor('#E5391B')
      .text(`#${input.order_code}`, col2X + 48, metaTop + 27);

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Date:', col2X, metaTop + 45);
    doc.font(fontBold).fontSize(8.8).fillColor('#111827').text(dateStr, col2X + 48, metaTop + 45);

    doc.font(fontBody).fontSize(8.2).fillColor('#6B7280').text('Time:', col2X, metaTop + 62);
    doc.font(fontBold).fontSize(8.8).fillColor('#111827').text(timeStr, col2X + 48, metaTop + 62);

    // Order Items Table
    const itemColX = left + 10;
    const qtyColX = left + contentWidth - 148;
    const priceColX = left + contentWidth - 104;
    const totalColX = left + contentWidth - 58;

    const drawItemsTableHeader = (topY: number) => {
      doc
        .roundedRect(left, topY, contentWidth, 22, 5)
        .fillColor('#FEF2F0')
        .fill();
      doc.font(fontBold).fontSize(8.5).fillColor('#991B1B');
      doc.text('Item Name', itemColX, topY + 6, { width: 168 });
      doc.text('Qty', qtyColX, topY + 6, { width: 34, align: 'center' });
      doc.text('Price', priceColX, topY + 6, { width: 44, align: 'right' });
      doc.text('Total', totalColX, topY + 6, { width: 50, align: 'right' });
      return topY + 28;
    };

    let y = 208;
    doc
      .font(fontBold)
      .fontSize(9)
      .fillColor('#111827')
      .text('ORDER', left, y);
    y += 15;
    y = drawItemsTableHeader(y);

    for (const line of input.items) {
      if (y > pageHeight - 135) {
        doc.addPage();
        drawPageFrame(doc);
        y = drawItemsTableHeader(32);
      }

      doc.font(fontBold).fontSize(9).fillColor('#111827');
      doc.text(line.name, itemColX, y, { width: 166, ellipsis: true });

      doc.font(fontBody).fontSize(9).fillColor('#374151');
      doc.text(String(line.quantity), qtyColX, y, { width: 34, align: 'center' });
      doc.text(fmt(line.unit_price), priceColX, y, { width: 44, align: 'right' });

      doc.font(fontBold).fontSize(9).fillColor('#111827');
      doc.text(fmt(line.line_total), totalColX, y, { width: 50, align: 'right' });

      if (line.regular_price > line.unit_price) {
        y += 12;
        doc
          .font(fontBody)
          .fontSize(7.5)
          .fillColor('#15803D')
          .text(
            `Offer Applied: Regular ${fmt(line.regular_price)} -> ${fmt(line.unit_price)}`,
            itemColX,
            y,
          );
      }

      y += 15;
      doc
        .moveTo(left + 6, y)
        .lineTo(left + contentWidth - 6, y)
        .lineWidth(0.5)
        .strokeColor('#E5E7EB')
        .stroke();
      y += 7;
    }

    // Ensure totals + optional note fit cleanly above the footer without overlapping
    const neededForTotals = input.notes?.trim() ? 115 : 88;
    if (y + neededForTotals > footerY) {
      doc.addPage();
      drawPageFrame(doc);
      y = 38;
    }

    // Totals Summary Block
    y += 4;
    const summaryLeft = left + contentWidth - 190;
    doc.font(fontBody).fontSize(9.5).fillColor('#4B5563');
    doc.text('Subtotal:', summaryLeft, y, { width: 98, align: 'right' });
    doc
      .font(fontBold)
      .fillColor('#111827')
      .text(fmt(input.subtotal), summaryLeft + 102, y, { width: 82, align: 'right' });
    y += 16;

    doc
      .font(fontBody)
      .fontSize(9.5)
      .fillColor(input.discount > 0 ? '#15803D' : '#6B7280');
    doc.text('Discount:', summaryLeft, y, { width: 98, align: 'right' });
    doc
      .font(fontBold)
      .fillColor(input.discount > 0 ? '#15803D' : '#6B7280')
      .text(input.discount > 0 ? `-${fmt(input.discount)}` : fmt(0), summaryLeft + 102, y, {
        width: 82,
        align: 'right',
      });
    y += 18;

    doc
      .roundedRect(summaryLeft - 6, y, 196, 30, 8)
      .fillColor('#E5391B')
      .fill();
    doc
      .font(fontBold)
      .fontSize(11)
      .fillColor('#FFFFFF')
      .text('FINAL TOTAL:', summaryLeft, y + 8.5, { width: 94, align: 'right' });
    doc
      .font(fontBold)
      .fontSize(12.5)
      .fillColor('#FFFFFF')
      .text(fmt(input.total), summaryLeft + 98, y + 7.5, { width: 86, align: 'right' });

    if (input.notes && input.notes.trim()) {
      y += 38;
      doc
        .font(fontBody)
        .fontSize(8)
        .fillColor('#6B7280')
        .text(`Special Request: ${input.notes.trim()}`, left, y, { width: contentWidth });
    }

    // Branded Fast-Food Footer Strip
    doc
      .moveTo(left, footerY)
      .lineTo(left + contentWidth, footerY)
      .lineWidth(0.8)
      .strokeColor('#E5E7EB')
      .stroke();

    drawVectorFries(doc, left + 10, footerY + 18, 0.85);
    drawVectorRoll(doc, left + 42, footerY + 20, 0.8);
    drawVectorDrink(doc, left + contentWidth - 38, footerY + 18, 0.85);

    doc
      .font(fontBold)
      .fontSize(11.5)
      .fillColor('#E5391B')
      .text('THANK YOU!', left, footerY + 14, { width: contentWidth, align: 'center' });

    doc
      .font(fontBold)
      .fontSize(9)
      .fillColor('#111827')
      .text('Thank You for visiting RikZen Fast Food', left, footerY + 32, {
        width: contentWidth,
        align: 'center',
      });

    doc
      .font(fontBody)
      .fontSize(8.5)
      .fillColor('#6B7280')
      .text('We hope to serve you again!', left, footerY + 46, {
        width: contentWidth,
        align: 'center',
      });

    doc.end();
  });
}
