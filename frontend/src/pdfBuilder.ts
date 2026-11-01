import { AdjustmentParams } from './colorScience';

export type PaperSize = 'letter' | 'a4';

export interface PdfCardInput {
  id: string;
  fileName: string;
  canvas: HTMLCanvasElement;
  quantity: number;
  adjustments: AdjustmentParams;
}

export interface PdfSheetConfig {
  paperSize: PaperSize;
  cardWidthMm: number; // default 63.0
  cardHeightMm: number; // default 88.0
  guideWidthMm: number; // default 0.265
  guideColor: string; // '#000000'
  showGuides: boolean;
  extendGuidesToEdge: boolean;
}

export interface PdfGenerationOptions {
  cards: PdfCardInput[];
  config: PdfSheetConfig;
  onProgress?: (current: number, total: number) => void;
}

// Helper: Convert mm to PDF typographic points (1 in = 25.4 mm = 72 pt)
export const MM_TO_PT = 72 / 25.4;

export const PAPER_DIMENSIONS_PT: Record<PaperSize, { wPt: number; hPt: number; name: string }> = {
  letter: {
    wPt: 8.5 * 72, // 612 pt
    hPt: 11.0 * 72, // 792 pt
    name: 'US Letter (8.5 × 11 in)'
  },
  a4: {
    wPt: 210.0 * MM_TO_PT, // ~595.28 pt
    hPt: 297.0 * MM_TO_PT, // ~841.89 pt
    name: 'A4 (210 × 297 mm)'
  }
};

/**
 * Compress an RGB Uint8Array using browser/Node standard CompressionStream('deflate')
 * Lossless RFC 1950 zlib stream required by PDF /Filter /FlateDecode.
 */
async function compressFlateRgb(rawRgb: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([rawRgb as any]).stream().pipeThrough(new CompressionStream('deflate'));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  // Fallback: If CompressionStream is unavailable, return raw uncompressed bytes (handled without FlateDecode)
  return rawRgb;
}

/**
 * Extract raw 24-bit RGB pixel buffer from an HTMLCanvasElement without alpha channel
 */
export function extractCanvasRgb(canvas: HTMLCanvasElement): {
  width: number;
  height: number;
  rgb: Uint8Array;
} {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.getImageData(0, 0, width, height);
  const rgba = imgData.data;
  const rgb = new Uint8Array(width * height * 3);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }

  return { width, height, rgb };
}

/**
 * Parse hex color '#000000' or '#333333' into normalized [r, g, b] in [0, 1]
 */
function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [0, 0, 0];
}

/**
 * Pure TypeScript, Standards-Compliant PDF 1.4 Builder.
 * Generates exact physical 3x3 proxy sheets with vector cutting guides (0.265mm)
 * and 100% lossless uncompressed / FlateDecode image streams.
 */
export async function createProxyPrintPdf(options: PdfGenerationOptions): Promise<Blob> {
  const { cards, config, onProgress } = options;
  const paper = PAPER_DIMENSIONS_PT[config.paperSize] || PAPER_DIMENSIONS_PT.letter;

  const cardWPt = config.cardWidthMm * MM_TO_PT;
  const cardHPt = config.cardHeightMm * MM_TO_PT;
  const guideLineWidthPt = Math.max(0.1, config.guideWidthMm * MM_TO_PT);

  const gridWPt = 3 * cardWPt;
  const gridHPt = 3 * cardHPt;

  // Center 3x3 grid perfectly on the sheet
  const marginXPt = Math.max(0, (paper.wPt - gridWPt) / 2);
  const marginYPt = Math.max(0, (paper.hPt - gridHPt) / 2);

  // Flatten card items according to their selected quantities
  const flattenedCards: HTMLCanvasElement[] = [];
  for (const card of cards) {
    const count = Math.max(1, card.quantity || 1);
    for (let q = 0; q < count; q++) {
      flattenedCards.push(card.canvas);
    }
  }

  const totalCards = Math.max(1, flattenedCards.length);
  const totalPages = Math.ceil(totalCards / 9);

  // PDF Generation State
  const parts: (Uint8Array | string)[] = [];
  const objectOffsets: number[] = [];
  let currentByteOffset = 0;

  function write(chunk: Uint8Array | string) {
    if (typeof chunk === 'string') {
      const encoded = new TextEncoder().encode(chunk);
      parts.push(encoded);
      currentByteOffset += encoded.length;
    } else {
      parts.push(chunk);
      currentByteOffset += chunk.length;
    }
  }

  // File Header
  write('%PDF-1.4\n%âãÏÓ\n');

  // Object Registry
  // 1: Catalog
  // 2: Pages
  // 3..2+totalPages: Page objects
  // followed by Contents and Image XObjects
  let nextObjId = 1;
  const catalogObjId = nextObjId++;
  const pagesObjId = nextObjId++;

  const pageObjIds: number[] = [];
  for (let p = 0; p < totalPages; p++) {
    pageObjIds.push(nextObjId++);
  }

  // Pre-process & compress unique card canvases
  // Map canvas to object ID and compressed data
  interface ImageObjInfo {
    objId: number;
    width: number;
    height: number;
    compressed: Uint8Array;
    isFlate: boolean;
  }
  const canvasToImageObj = new Map<HTMLCanvasElement, ImageObjInfo>();

  for (let i = 0; i < flattenedCards.length; i++) {
    const cvs = flattenedCards[i];
    if (!canvasToImageObj.has(cvs)) {
      if (onProgress) {
        onProgress(i + 1, flattenedCards.length);
      }
      const { width, height, rgb } = extractCanvasRgb(cvs);
      const compressed = await compressFlateRgb(rgb);
      const isFlate = compressed.length < rgb.length;
      canvasToImageObj.set(cvs, {
        objId: nextObjId++,
        width,
        height,
        compressed: isFlate ? compressed : rgb,
        isFlate
      });
    }
  }

  // Write Catalog (Obj 1)
  objectOffsets[catalogObjId] = currentByteOffset;
  write(`${catalogObjId} 0 obj\n<< /Type /Catalog /Pages ${pagesObjId} 0 R >>\nendobj\n`);

  // Write Pages parent (Obj 2)
  objectOffsets[pagesObjId] = currentByteOffset;
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  write(`${pagesObjId} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>\nendobj\n`);

  // Prepare Page Contents & Page definitions
  const pageContentsObjIds: number[] = [];

  for (let p = 0; p < totalPages; p++) {
    const pageIndex = p;
    const contentsObjId = nextObjId++;
    pageContentsObjIds.push(contentsObjId);

    const startIndex = pageIndex * 9;
    const pageCanvases = flattenedCards.slice(startIndex, startIndex + 9);

    // Resources mapping for this page
    const pageXObjects: string[] = [];
    const contentStreamParts: string[] = [];

    // Draw 3x3 cards
    for (let slot = 0; slot < pageCanvases.length; slot++) {
      const cvs = pageCanvases[slot];
      const imgInfo = canvasToImageObj.get(cvs)!;
      const resName = `Im${slot}`;
      pageXObjects.push(`/${resName} ${imgInfo.objId} 0 R`);

      const col = slot % 3; // 0 (left), 1 (center), 2 (right)
      const row = Math.floor(slot / 3); // 0 (top), 1 (middle), 2 (bottom)

      const cardLeftPt = marginXPt + col * cardWPt;
      // In PDF, Y=0 is at bottom of page. Row 0 is at top:
      const cardBottomPt = marginYPt + (2 - row) * cardHPt;

      contentStreamParts.push(
        `q\n${cardWPt.toFixed(4)} 0 0 ${cardHPt.toFixed(4)} ${cardLeftPt.toFixed(4)} ${cardBottomPt.toFixed(4)} cm\n/${resName} Do\nQ\n`
      );
    }

    // Draw Cutting Guides (Width: 0.265mm)
    if (config.showGuides) {
      const [gr, gg, gb] = parseHexColor(config.guideColor);
      contentStreamParts.push('q\n');
      contentStreamParts.push(`${guideLineWidthPt.toFixed(4)} w\n`);
      contentStreamParts.push(`${gr.toFixed(3)} ${gg.toFixed(3)} ${gb.toFixed(3)} RG\n`);

      const x0 = marginXPt;
      const x1 = marginXPt + 1 * cardWPt;
      const x2 = marginXPt + 2 * cardWPt;
      const x3 = marginXPt + 3 * cardWPt;

      const y0 = marginYPt;
      const y1 = marginYPt + 1 * cardHPt;
      const y2 = marginYPt + 2 * cardHPt;
      const y3 = marginYPt + 3 * cardHPt;

      // Vertical guide lines (between and around cards)
      const vertXCoords = [x0, x1, x2, x3];
      for (const vx of vertXCoords) {
        if (config.extendGuidesToEdge) {
          // Continuous cut line from bottom of sheet to top of sheet for rotary/guillotine trimmers
          contentStreamParts.push(`${vx.toFixed(4)} 0 m ${vx.toFixed(4)} ${paper.hPt.toFixed(4)} l S\n`);
        } else {
          // Boundary line within grid plus 5mm tick marks outward
          const tickPt = 5 * MM_TO_PT;
          contentStreamParts.push(
            `${vx.toFixed(4)} ${(y0 - tickPt).toFixed(4)} m ${vx.toFixed(4)} ${(y3 + tickPt).toFixed(4)} l S\n`
          );
        }
      }

      // Horizontal guide lines (between and around cards)
      const horizYCoords = [y0, y1, y2, y3];
      for (const hy of horizYCoords) {
        if (config.extendGuidesToEdge) {
          // Continuous cut line from left of sheet to right of sheet
          contentStreamParts.push(`0 ${hy.toFixed(4)} m ${paper.wPt.toFixed(4)} ${hy.toFixed(4)} l S\n`);
        } else {
          const tickPt = 5 * MM_TO_PT;
          contentStreamParts.push(
            `${(x0 - tickPt).toFixed(4)} ${hy.toFixed(4)} m ${(x3 + tickPt).toFixed(4)} ${hy.toFixed(4)} l S\n`
          );
        }
      }

      contentStreamParts.push('Q\n');
    }

    // Write Page Object
    objectOffsets[pageObjIds[p]] = currentByteOffset;
    write(
      `${pageObjIds[p]} 0 obj\n<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${paper.wPt.toFixed(2)} ${paper.hPt.toFixed(2)}] /Resources << /ProcSet [/PDF /ImageC] /XObject << ${pageXObjects.join(' ')} >> >> /Contents ${contentsObjId} 0 R >>\nendobj\n`
    );

    // Write Page Contents Stream
    const fullContentStr = contentStreamParts.join('');
    const fullContentBytes = new TextEncoder().encode(fullContentStr);
    objectOffsets[contentsObjId] = currentByteOffset;
    write(
      `${contentsObjId} 0 obj\n<< /Length ${fullContentBytes.length} >>\nstream\n${fullContentStr}endstream\nendobj\n`
    );
  }

  // Write all unique Image XObjects
  for (const [, imgInfo] of canvasToImageObj.entries()) {
    objectOffsets[imgInfo.objId] = currentByteOffset;
    const filterStr = imgInfo.isFlate ? '/Filter /FlateDecode ' : '';
    write(
      `${imgInfo.objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgInfo.width} /Height ${imgInfo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${filterStr}/Length ${imgInfo.compressed.length} >>\nstream\n`
    );
    write(imgInfo.compressed);
    write('\nendstream\nendobj\n');
  }

  // Write Cross-Reference Table (Xref)
  const startXrefOffset = currentByteOffset;
  const totalObjCount = nextObjId;
  write(`xref\n0 ${totalObjCount}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjCount; id++) {
    const off = objectOffsets[id] || 0;
    write(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  // Write Trailer & EOF
  write(`trailer\n<< /Size ${totalObjCount} /Root ${catalogObjId} 0 R >>\nstartxref\n${startXrefOffset}\n%%EOF\n`);

  // Assemble unified Blob
  const blobParts: BlobPart[] = [];
  for (const part of parts) {
    blobParts.push(part as any);
  }

  return new Blob(blobParts, { type: 'application/pdf' });
}
