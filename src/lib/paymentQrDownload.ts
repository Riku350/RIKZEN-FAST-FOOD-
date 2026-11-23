import QRCode from 'qrcode';

export interface DownloadPaymentQrParams {
  mode: 'uploaded_qr' | 'dynamic_upi';
  upiUri?: string;
  qrImageUrl?: string;
  merchantName?: string;
  upiId?: string;
  amount: number;
  orderCode: string;
  tableNumber?: number;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function loadImageElement(src: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load QR image.'));
    img.src = src;
  });
}

/**
 * Generates and downloads a crisp, high-resolution, 100% scannable Payment QR PNG
 * (`RikZen-Payment-QR-RKxxxx.png`) directly to the customer's device gallery / Downloads folder.
 *
 * - Dynamic UPI mode: renders exact-amount NPCI `upi://pay?...` QR with Error Correction H & wide white margin.
 * - Uploaded QR mode: preserves the exact restaurant QR image without cropping or distortion.
 */
export async function downloadPaymentQrPng(params: DownloadPaymentQrParams): Promise<string> {
  const cleanCode = (params.orderCode || 'BILL')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  const filename = `RikZen-Payment-QR-${cleanCode}.png`;
  const merchantName = (params.merchantName || 'RikZen Fast Food').trim();
  const formattedAmount = `₹${Math.round(Number(params.amount) || 0).toLocaleString('en-IN')}`;

  const canvas = document.createElement('canvas');
  const width = 900;
  const height = 1140;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas is unavailable for QR download.');
  }

  // Clean pure-white card background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Top brand header band
  ctx.fillStyle = '#151110';
  ctx.fillRect(0, 0, width, 168);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 42px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('RIKZEN FAST FOOD', width / 2, 78);

  ctx.fillStyle = '#FDBA74';
  ctx.font = '700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  const metaLine = params.tableNumber
    ? `Order #${cleanCode}  •  Table ${params.tableNumber}`
    : `Order #${cleanCode}`;
  ctx.fillText(metaLine, width / 2, 126);

  // Amount banner
  ctx.fillStyle = '#525252';
  ctx.font = '700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('SCAN & PAY AMOUNT', width / 2, 224);

  ctx.fillStyle = '#E5391B';
  ctx.font = '800 58px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(formattedAmount, width / 2, 290);

  // QR Container Box (pure white with crisp border so scanners lock instantly)
  const qrBoxSize = 580;
  const qrBoxX = (width - qrBoxSize) / 2;
  const qrBoxY = 328;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 4;
  ctx.strokeRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);

  const innerPad = 24;
  const drawSize = qrBoxSize - innerPad * 2;
  const drawX = qrBoxX + innerPad;
  const drawY = qrBoxY + innerPad;

  if (params.mode === 'dynamic_upi' && params.upiUri) {
    const qrDataUrl = await QRCode.toDataURL(params.upiUri, {
      width: 720,
      margin: 3,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    const qrImg = await loadImageElement(qrDataUrl, false);
    ctx.drawImage(qrImg, drawX, drawY, drawSize, drawSize);
  } else if (params.qrImageUrl) {
    try {
      // Fetch as blob first so same-origin & CORS-enabled URLs never taint canvas
      const res = await fetch(params.qrImageUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not fetch uploaded QR image.');
      const imgBlob = await res.blob();
      const objUrl = URL.createObjectURL(imgBlob);
      try {
        const qrImg = await loadImageElement(objUrl, false);
        // Contain-fit without ANY cropping or stretching
        const scale = Math.min(drawSize / qrImg.naturalWidth, drawSize / qrImg.naturalHeight);
        const targetW = qrImg.naturalWidth * scale;
        const targetH = qrImg.naturalHeight * scale;
        const offsetX = drawX + (drawSize - targetW) / 2;
        const offsetY = drawY + (drawSize - targetH) / 2;
        ctx.drawImage(qrImg, offsetX, offsetY, targetW, targetH);
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    } catch {
      // Fallback: try direct crossOrigin image load; if that fails too, open/download direct URL
      try {
        const qrImg = await loadImageElement(params.qrImageUrl, true);
        const scale = Math.min(drawSize / qrImg.naturalWidth, drawSize / qrImg.naturalHeight);
        const targetW = qrImg.naturalWidth * scale;
        const targetH = qrImg.naturalHeight * scale;
        const offsetX = drawX + (drawSize - targetW) / 2;
        const offsetY = drawY + (drawSize - targetH) / 2;
        ctx.drawImage(qrImg, offsetX, offsetY, targetW, targetH);
      } catch {
        const a = document.createElement('a');
        a.href = params.qrImageUrl;
        a.download = filename;
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return filename;
      }
    }
  } else {
    throw new Error('Payment QR is not configured for this bill.');
  }

  // Bottom Merchant & UPI Details
  ctx.fillStyle = '#171717';
  ctx.font = '800 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(merchantName, width / 2, 968);

  if (params.upiId) {
    ctx.fillStyle = '#404040';
    ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`UPI ID: ${params.upiId}`, width / 2, 1008);
  }

  ctx.fillStyle = '#047857';
  ctx.font = '700 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(
    params.mode === 'dynamic_upi'
      ? `Exact amount ${formattedAmount} is pre-filled when scanned`
      : `Scan in any UPI app and pay ${formattedAmount}`,
    width / 2,
    params.upiId ? 1052 : 1022,
  );

  ctx.fillStyle = '#737373';
  ctx.font = '600 19px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('PhonePe  •  Google Pay  •  Paytm  •  BHIM', width / 2, 1098);

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export QR image.'));
    }, 'image/png');
  });

  triggerBlobDownload(pngBlob, filename);
  return filename;
}
