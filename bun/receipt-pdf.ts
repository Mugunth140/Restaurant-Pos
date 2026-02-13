import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ── types ──────────────────────────────────────────────────────────────────── */

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface ReceiptPayload {
  billNo: string;
  printedAt: string;
  subtotalCents: number;
  discountRateBps: number;
  discountCents: number;
  totalCents: number;
  items: ReceiptItem[];
}

/* ── text formatting helpers (mirrors the Rust receipt logic) ───────────────── */

const WIDTH = 42;

function centsToRs(cents: number): string {
  return (cents / 100).toFixed(2);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function fitText(value: string, width: number): string {
  return value.trim().slice(0, width);
}

function center(value: string, width: number): string {
  const trimmed = value.trim();
  if (trimmed.length >= width) return trimmed.slice(0, width);
  const left = Math.floor((width - trimmed.length) / 2);
  return " ".repeat(left) + trimmed;
}

function lineTwoCol(left: string, right: string, width: number): string {
  if (right.length >= width) return fitText(right, width);
  const leftRoom = Math.max(0, width - right.length - 1);
  const leftText = fitText(left, leftRoom);
  const spaces = Math.max(0, width - leftText.length - right.length);
  return leftText + " ".repeat(spaces) + right;
}

function separator(width: number): string {
  return "-".repeat(width);
}

/* ── format receipt into lines ──────────────────────────────────────────────── */

function formatReceiptLines(payload: ReceiptPayload): string[] {
  const lines: string[] = [];

  lines.push(center("Fresh Food | Fast Service", WIDTH));
  lines.push(separator(WIDTH));
  lines.push(lineTwoCol(`Bill: ${payload.billNo}`, payload.printedAt, WIDTH));
  lines.push(separator(WIDTH));
  lines.push(
    `${padRight("Item", 20)} ${padLeft("Qty", 5)} ${padLeft("Rate", 7)} ${padLeft("Amount", 10)}`,
  );
  lines.push(separator(WIDTH));

  for (const item of payload.items) {
    const name = fitText(item.name, 20);
    lines.push(
      `${padRight(name, 20)} ${padLeft(String(item.qty), 5)} ${padLeft(centsToRs(item.unitPriceCents), 7)} ${padLeft(centsToRs(item.lineTotalCents), 10)}`,
    );
  }

  lines.push(separator(WIDTH));
  lines.push(
    lineTwoCol("Subtotal", `Rs ${centsToRs(payload.subtotalCents)}`, WIDTH),
  );
  lines.push(
    lineTwoCol(
      `Discount (${(payload.discountRateBps / 100).toFixed(2)}%)`,
      `-Rs ${centsToRs(payload.discountCents)}`,
      WIDTH,
    ),
  );
  lines.push(
    lineTwoCol("TOTAL", `Rs ${centsToRs(payload.totalCents)}`, WIDTH),
  );
  lines.push(separator(WIDTH));
  lines.push(center("Thank you. Visit again!", WIDTH));

  return lines;
}

/* ── generate PDF ───────────────────────────────────────────────────────────── */

export async function generateReceiptPdf(
  payload: ReceiptPayload,
): Promise<Uint8Array> {
  const lines = formatReceiptLines(payload);

  const bodyFontSize = 7.6;
  const bodyLineHeight = bodyFontSize * 1.2;
  const marginX = 6;
  const marginTop = 7;
  const marginBottom = 8;
  const titleSize = 14;

  // 80mm ≈ 226.77 points
  const pageWidth = 226.77;
  const calculatedHeight = marginTop + titleSize + 6 + lines.length * bodyLineHeight + marginBottom;
  const minimumPortraitHeight = pageWidth + 20;
  const pageHeight = Math.max(calculatedHeight, minimumPortraitHeight);

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const title = "MEET & EAT";
  const titleWidth = boldFont.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (pageWidth - titleWidth) / 2,
    y: pageHeight - marginTop - titleSize,
    size: titleSize,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  let y = pageHeight - marginTop - titleSize - 6 - bodyFontSize;
  for (const line of lines) {
    page.drawText(line, {
      x: marginX,
      y,
      size: bodyFontSize,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= bodyLineHeight;
  }

  return pdfDoc.save();
}
