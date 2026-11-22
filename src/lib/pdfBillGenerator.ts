import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
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
  upi_id?: string;
  merchant_name?: string;
  upi_uri?: string;
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
 * Generates a real, verified, branded RikZen Fast Food PDF invoice buffer
 * with an embedded high-resolution, error-correction-H exact-amount dynamic UPI QR.
 */
export async function generateBrandedBillPdfBuffer(input: BillPdfInput): Promise<Buffer> {
  // Pre-render crisp monochrome high-resolution UPI QR PNG buffer if dynamic UPI URI is configured
  let qrPngBuffer: Buffer | null = null;
  const trimmedUpiUri = typeof input.upi_uri === 'string' ? input.upi_uri.trim() : '';
  const trimmedUpiId = typeof input.upi_id === 'string' ? input.upi_id.trim() : '';

  if (trimmedUpiUri && trimmedUpiUri.startsWith('upi://pay?')) {
    qrPngBuffer = await QRCode.toBuffer(trimmedUpiUri, {
      type: 'png',
      width: 512,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
  }

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
    const footerY = pageHeight - 76;

    drawPageFrame(doc);

    // Header Banner
    doc
      .roundedRect(left, 24, contentWidth, 64, 12)
      .fillColor('#151110')
      .fill();

    drawVectorBurger(doc, left + 12, 39, 0.88);
    drawVectorPizza(doc, left + contentWidth - 40, 39, 0.88);

    doc
      .font(fontBold)
      .fontSize(16.5)
      .fillColor('#FFFFFF')
      .text('RIKZEN FAST FOOD', left, 37, { width: contentWidth, align: 'center' });

    doc
      .font(fontBody)
      .fontSize(8.5)
      .fillColor('#FDBA74')
      .text('Fresh  •  Fast  •  Delicious', left, 59, {
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
    const metaTop = 98;
    doc
      .roundedRect(left, metaTop, contentWidth, 78, 10)
      .fillColor('#F9FAFB')
      .fill();
    doc
      .roundedRect(left, metaTop, contentWidth, 78, 10)
      .lineWidth(0.8)
      .strokeColor('#E5E7EB')
      .stroke();

    doc
      .font(fontBold)
      .fontSize(7.8)
      .fillColor('#E5391B')
      .text('CUSTOMER & ORDER DETAILS', left + 12, metaTop + 9);

    const col1X = left + 12;
    const col2X = left + Math.floor(contentWidth * 0.54);

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Customer:', col1X, metaTop + 25);
    doc
      .font(fontBold)
      .fontSize(8.8)
      .fillColor('#111827')
      .text(input.customer_name || 'Guest', col1X + 46, metaTop + 24, {
        width: col2X - col1X - 52,
        ellipsis: true,
      });

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Mobile:', col1X, metaTop + 41);
    doc
      .font(fontBold)
      .fontSize(8.5)
      .fillColor('#111827')
      .text(formatMobileDisplay(input.customer_mobile), col1X + 46, metaTop + 41, {
        width: col2X - col1X - 52,
      });

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Table:', col1X, metaTop + 57);
    doc
      .font(fontBold)
      .fontSize(8.8)
      .fillColor('#111827')
      .text(`Table ${input.table_number}`, col1X + 46, metaTop + 57);

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Order No:', col2X, metaTop + 25);
    doc
      .font(fontBold)
      .fontSize(9.2)
      .fillColor('#E5391B')
      .text(`#${input.order_code}`, col2X + 46, metaTop + 24);

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Date:', col2X, metaTop + 41);
    doc.font(fontBold).fontSize(8.5).fillColor('#111827').text(dateStr, col2X + 46, metaTop + 41);

    doc.font(fontBody).fontSize(8).fillColor('#6B7280').text('Time:', col2X, metaTop + 57);
    doc.font(fontBold).fontSize(8.5).fillColor('#111827').text(timeStr, col2X + 46, metaTop + 57);

    // Order Items Table
    const itemColX = left + 10;
    const qtyColX = left + contentWidth - 148;
    const priceColX = left + contentWidth - 104;
    const totalColX = left + contentWidth - 58;

    const drawItemsTableHeader = (topY: number) => {
      doc
        .roundedRect(left, topY, contentWidth, 20, 5)
        .fillColor('#FEF2F0')
        .fill();
      doc.font(fontBold).fontSize(8.2).fillColor('#991B1B');
      doc.text('Item', itemColX, topY + 5.5, { width: 168 });
      doc.text('Qty', qtyColX, topY + 5.5, { width: 34, align: 'center' });
      doc.text('Price', priceColX, topY + 5.5, { width: 44, align: 'right' });
      doc.text('Total', totalColX, topY + 5.5, { width: 50, align: 'right' });
      return topY + 25;
    };

    let y = 186;
    doc
      .font(fontBold)
      .fontSize(8.5)
      .fillColor('#111827')
      .text('ORDER ITEMS', left, y);
    y += 13;
    y = drawItemsTableHeader(y);

    for (const line of input.items) {
      if (y > pageHeight - 120) {
        doc.addPage();
        drawPageFrame(doc);
        y = drawItemsTableHeader(30);
      }

      doc.font(fontBold).fontSize(8.8).fillColor('#111827');
      doc.text(line.name, itemColX, y, { width: 166, ellipsis: true });

      doc.font(fontBody).fontSize(8.8).fillColor('#374151');
      doc.text(String(line.quantity), qtyColX, y, { width: 34, align: 'center' });
      doc.text(fmt(line.unit_price), priceColX, y, { width: 44, align: 'right' });

      doc.font(fontBold).fontSize(8.8).fillColor('#111827');
      doc.text(fmt(line.line_total), totalColX, y, { width: 50, align: 'right' });

      if (line.regular_price > line.unit_price) {
        y += 11;
        doc
          .font(fontBody)
          .fontSize(7.2)
          .fillColor('#15803D')
          .text(
            `Offer Applied: ${fmt(line.regular_price)} -> ${fmt(line.unit_price)}`,
            itemColX,
            y,
          );
      }

      y += 13;
      doc
        .moveTo(left + 6, y)
        .lineTo(left + contentWidth - 6, y)
        .lineWidth(0.5)
        .strokeColor('#E5E7EB')
        .stroke();
      y += 6;
    }

    // Check space needed for Totals + optional note + optional Dynamic UPI QR block
    const qrBlockHeight = qrPngBuffer ? 132 : 0;
    const noteHeight = input.notes?.trim() ? 20 : 0;
    const totalsHeight = 76;
    const neededBelowItems = totalsHeight + noteHeight + (qrPngBuffer ? qrBlockHeight + 10 : 0);

    if (y + neededBelowItems > footerY - 6) {
      doc.addPage();
      drawPageFrame(doc);
      y = 32;
    }

    // Totals Summary Block
    y += 2;
    const summaryLeft = left + contentWidth - 190;
    doc.font(fontBody).fontSize(9).fillColor('#4B5563');
    doc.text('Subtotal:', summaryLeft, y, { width: 98, align: 'right' });
    doc
      .font(fontBold)
      .fillColor('#111827')
      .text(fmt(input.subtotal), summaryLeft + 102, y, { width: 82, align: 'right' });
    y += 14;

    doc
      .font(fontBody)
      .fontSize(9)
      .fillColor(input.discount > 0 ? '#15803D' : '#6B7280');
    doc.text('Discount:', summaryLeft, y, { width: 98, align: 'right' });
    doc
      .font(fontBold)
      .fillColor(input.discount > 0 ? '#15803D' : '#6B7280')
      .text(input.discount > 0 ? `-${fmt(input.discount)}` : fmt(0), summaryLeft + 102, y, {
        width: 82,
        align: 'right',
      });
    y += 16;

    doc
      .roundedRect(summaryLeft - 6, y, 196, 28, 8)
      .fillColor('#E5391B')
      .fill();
    doc
      .font(fontBold)
      .fontSize(10.5)
      .fillColor('#FFFFFF')
      .text('TOTAL:', summaryLeft, y + 7.5, { width: 94, align: 'right' });
    doc
      .font(fontBold)
      .fontSize(12.5)
      .fillColor('#FFFFFF')
      .text(fmt(input.total), summaryLeft + 98, y + 6.5, { width: 86, align: 'right' });

    y += 34;

    if (input.notes && input.notes.trim()) {
      doc
        .font(fontBody)
        .fontSize(7.8)
        .fillColor('#6B7280')
        .text(`Special Request: ${input.notes.trim()}`, left, y, { width: contentWidth });
      y += 16;
    }

    // Dynamic Exact-Amount UPI Payment QR Card (Crisp monochrome, quiet-zone framed, high contrast)
    if (qrPngBuffer) {
      y += 4;
      if (y + qrBlockHeight > footerY - 6) {
        doc.addPage();
        drawPageFrame(doc);
        y = 32;
      }

      const cardHeight = 126;
      doc
        .roundedRect(left, y, contentWidth, cardHeight, 10)
        .fillColor('#FFFFFF')
        .fill();
      doc
        .roundedRect(left, y, contentWidth, cardHeight, 10)
        .lineWidth(1.1)
        .strokeColor('#151110')
        .stroke();

      // Left white frame holding razor-sharp monochrome QR (108pt x 108pt)
      const qrSize = 108;
      const qrX = left + 10;
      const qrY = y + 9;
      doc.image(qrPngBuffer, qrX, qrY, { width: qrSize, height: qrSize });

      // Right side clear payment details
      const infoX = qrX + qrSize + 14;
      const infoWidth = left + contentWidth - infoX - 10;

      doc
        .roundedRect(infoX, y + 12, 86, 17, 4)
        .fillColor('#151110')
        .fill();
      doc
        .font(fontBold)
        .fontSize(8)
        .fillColor('#FFFFFF')
        .text('SCAN TO PAY', infoX, y + 16, { width: 86, align: 'center' });

      doc
        .font(fontBold)
        .fontSize(16)
        .fillColor('#E5391B')
        .text(`Pay ${fmt(input.total)}`, infoX, y + 36, { width: infoWidth });

      doc
        .font(fontBold)
        .fontSize(8.2)
        .fillColor('#111827')
        .text(input.merchant_name?.trim() || 'RikZen Fast Food', infoX, y + 58, {
          width: infoWidth,
          ellipsis: true,
        });

      if (trimmedUpiId) {
        doc
          .font(fontBody)
          .fontSize(7.8)
          .fillColor('#4B5563')
          .text(`UPI ID: ${trimmedUpiId}`, infoX, y + 71, {
            width: infoWidth,
            ellipsis: true,
          });
      }

      doc
        .font(fontBold)
        .fontSize(7.8)
        .fillColor('#15803D')
        .text('Scan to pay this exact bill amount', infoX, y + 86, { width: infoWidth });

      doc
        .font(fontBody)
        .fontSize(7.3)
        .fillColor('#6B7280')
        .text('PhonePe • Google Pay • Paytm • BHIM', infoX, y + 102, { width: infoWidth });
    }

    // Branded Fast-Food Footer Strip
    doc
      .moveTo(left, footerY)
      .lineTo(left + contentWidth, footerY)
      .lineWidth(0.8)
      .strokeColor('#E5E7EB')
      .stroke();

    drawVectorFries(doc, left + 10, footerY + 12, 0.78);
    drawVectorRoll(doc, left + 40, footerY + 14, 0.72);
    drawVectorDrink(doc, left + contentWidth - 36, footerY + 12, 0.78);

    doc
      .font(fontBold)
      .fontSize(10.5)
      .fillColor('#E5391B')
      .text('THANK YOU!', left, footerY + 10, { width: contentWidth, align: 'center' });

    doc
      .font(fontBold)
      .fontSize(8.5)
      .fillColor('#111827')
      .text('Thank You for visiting RikZen Fast Food', left, footerY + 26, {
        width: contentWidth,
        align: 'center',
      });

    doc
      .font(fontBody)
      .fontSize(8)
      .fillColor('#6B7280')
      .text('We hope to serve you again!', left, footerY + 39, {
        width: contentWidth,
        align: 'center',
      });

    doc.end();
  });
}
