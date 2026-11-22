import JSZip from 'jszip';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { TABLE_NUMBERS } from '../data/menuCatalog';
import { getTableQrUrl } from './orderService';
import { parseUpiQrPayload } from './upiPayment';

/**
 * Decodes a UPI payment QR screenshot (GPay, PhonePe, Paytm, BHIM, BharatPe, etc.)
 * directly in the browser so the owner can bind their exact UPI ID with one upload.
 */
export async function decodeUpiQrFromImageFile(file: File): Promise<{
  upiId: string | null;
  merchantName: string | null;
  rawText: string | null;
}> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read image file.'));
      el.src = imageUrl;
    });

    // Try multiple scales (original + scaled down) for maximum QR decode reliability on phone screenshots
    const scales = [1, 0.75, 0.5, 1.4];
    for (const scale of scales) {
      const width = Math.max(120, Math.min(2000, Math.round(img.naturalWidth * scale)));
      const height = Math.max(120, Math.min(2000, Math.round(img.naturalHeight * scale)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (decoded?.data) {
        const parsed = parseUpiQrPayload(decoded.data);
        return {
          upiId: parsed?.upiId ?? null,
          merchantName: parsed?.merchantName ?? null,
          rawText: decoded.data,
        };
      }
    }

    return { upiId: null, merchantName: null, rawText: null };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/**
 * Renders a high-resolution, print-ready branded RikZen Fast Food Table QR card PNG
 * (1200 x 1560 px) with an ultra-sharp, high-contrast H-level QR code and ample quiet zone.
 */
export async function renderBrandedTableQrPngBlob(
  tableNumber: number,
  tableUrl: string = getTableQrUrl(tableNumber),
): Promise<Blob> {
  const width = 1200;
  const height = 1560;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas for QR PNG export.');
  }

  // Crisp pure white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Outer subtle border frame
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 8;
  roundRectPath(ctx, 36, 36, width - 72, height - 72, 48);
  ctx.stroke();

  // Top dark header banner
  ctx.fillStyle = '#151110';
  roundRectPath(ctx, 68, 68, width - 136, 210, 36);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 58px system-ui, -apple-system, sans-serif';
  ctx.fillText('RIKZEN FAST FOOD', width / 2, 168);

  ctx.fillStyle = '#FDBA74';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText('Fresh  •  Fast  •  Delicious', width / 2, 226);

  // Table badge
  ctx.fillStyle = '#E5391B';
  roundRectPath(ctx, width / 2 - 220, 316, 440, 102, 28);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 54px system-ui, -apple-system, sans-serif';
  ctx.fillText(`TABLE ${tableNumber}`, width / 2, 386);

  // Subtitle
  ctx.fillStyle = '#111827';
  ctx.font = '800 44px system-ui, -apple-system, sans-serif';
  ctx.fillText('Scan to Order', width / 2, 484);

  // High-contrast QR box (zero blur, zero compression, pure #000 on #FFF)
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, tableUrl, {
    width: 780,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  const qrBoxSize = 820;
  const qrBoxX = (width - qrBoxSize) / 2;
  const qrBoxY = 524;

  ctx.fillStyle = '#FFFFFF';
  roundRectPath(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  ctx.fill();
  ctx.strokeStyle = '#151110';
  ctx.lineWidth = 6;
  roundRectPath(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  ctx.stroke();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, qrBoxX + 20, qrBoxY + 20, 780, 780);
  ctx.imageSmoothingEnabled = true;

  // Footer instructions
  ctx.fillStyle = '#15803D';
  ctx.font = '700 32px system-ui, -apple-system, sans-serif';
  ctx.fillText('NO LOGIN REQUIRED  •  SCAN • ORDER • ENJOY', width / 2, 1418);

  ctx.fillStyle = '#6B7280';
  ctx.font = '500 24px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(`/menu?table=${tableNumber}`, width / 2, 1472);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode Table QR PNG.'));
          return;
        }
        resolve(blob);
      },
      'image/png',
      1,
    );
  });
}

export function getMainMenuQrUrl(): string {
  if (typeof window === 'undefined') return '/menu';
  return `${window.location.origin}/menu`;
}

/**
 * Renders a high-resolution, print-ready branded Main Website QR card PNG (`/menu`)
 * for counters, doors, and takeaway desks.
 */
export async function renderBrandedMainMenuQrPngBlob(
  menuUrl: string = getMainMenuQrUrl(),
): Promise<Blob> {
  const width = 1200;
  const height = 1560;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas for Main Website QR export.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 8;
  roundRectPath(ctx, 36, 36, width - 72, height - 72, 48);
  ctx.stroke();

  ctx.fillStyle = '#151110';
  roundRectPath(ctx, 68, 68, width - 136, 210, 36);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 58px system-ui, -apple-system, sans-serif';
  ctx.fillText('RIKZEN FAST FOOD', width / 2, 168);

  ctx.fillStyle = '#FDBA74';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText('Fresh  •  Fast  •  Delicious', width / 2, 226);

  ctx.fillStyle = '#E5391B';
  roundRectPath(ctx, width / 2 - 280, 316, 560, 102, 28);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 48px system-ui, -apple-system, sans-serif';
  ctx.fillText('SCAN FOR MENU', width / 2, 384);

  ctx.fillStyle = '#111827';
  ctx.font = '800 40px system-ui, -apple-system, sans-serif';
  ctx.fillText('Select Your Table & Order Instantly', width / 2, 484);

  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, menuUrl, {
    width: 780,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  const qrBoxSize = 820;
  const qrBoxX = (width - qrBoxSize) / 2;
  const qrBoxY = 524;

  ctx.fillStyle = '#FFFFFF';
  roundRectPath(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  ctx.fill();
  ctx.strokeStyle = '#151110';
  ctx.lineWidth = 6;
  roundRectPath(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  ctx.stroke();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, qrBoxX + 20, qrBoxY + 20, 780, 780);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = '#15803D';
  ctx.font = '700 32px system-ui, -apple-system, sans-serif';
  ctx.fillText('NO LOGIN REQUIRED  •  SCAN • ORDER • ENJOY', width / 2, 1418);

  ctx.fillStyle = '#6B7280';
  ctx.font = '500 24px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText('/menu', width / 2, 1472);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode Main Website QR PNG.'));
          return;
        }
        resolve(blob);
      },
      'image/png',
      1,
    );
  });
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Downloads a single high-resolution Table QR PNG:
 * `RikZen-Table-{N}-QR.png`
 */
export async function downloadSingleTableQrPng(tableNumber: number): Promise<string> {
  const filename = `RikZen-Table-${tableNumber}-QR.png`;
  const blob = await renderBrandedTableQrPngBlob(tableNumber, getTableQrUrl(tableNumber));
  triggerBlobDownload(blob, filename);
  return filename;
}

/**
 * Downloads the high-resolution Main Website QR PNG:
 * `RikZen-Main-Website-QR.png`
 */
export async function downloadMainMenuQrPng(): Promise<string> {
  const filename = 'RikZen-Main-Website-QR.png';
  const blob = await renderBrandedMainMenuQrPngBlob(getMainMenuQrUrl());
  triggerBlobDownload(blob, filename);
  return filename;
}

/**
 * Generates and downloads a real ZIP archive containing all 6 print-ready Table QR PNGs
 * plus the Main Website QR:
 * `RikZen-Fast-Food-Table-QRs.zip` -> `RikZen-Table-1-QR.png` ... `RikZen-Table-6-QR.png`
 */
export async function downloadAllTableQrsZip(): Promise<string> {
  const zip = new JSZip();
  for (const tableNumber of TABLE_NUMBERS) {
    const blob = await renderBrandedTableQrPngBlob(tableNumber, getTableQrUrl(tableNumber));
    const buffer = await blob.arrayBuffer();
    zip.file(`RikZen-Table-${tableNumber}-QR.png`, buffer);
  }
  const mainBlob = await renderBrandedMainMenuQrPngBlob(getMainMenuQrUrl());
  zip.file('RikZen-Main-Website-QR.png', await mainBlob.arrayBuffer());
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const filename = 'RikZen-Fast-Food-Table-QRs.zip';
  triggerBlobDownload(zipBlob, filename);
  return filename;
}
