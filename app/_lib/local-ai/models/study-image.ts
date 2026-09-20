// Shared encoded-image preflight used by the Phase 2 study and import runtime.
import { PHASE2_LIMITS as limits } from "../phase2-limits.generated";
export interface ImageHeader { type: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; orientation: number }
const fail = (): never => { throw new Error("Invalid or unsupported image"); };
export function inspectStudyImage(bytes: Uint8Array): ImageHeader {
  if (!bytes.length || bytes.length > limits.maxEncodedBytes) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, size: number) => String.fromCharCode(...bytes.slice(offset, offset + size));
  let header: ImageHeader | undefined;
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === "PNG\r\n\x1a\n" && text(12, 4) === "IHDR") {
    if (view.getUint32(8) !== 13) fail();
    header = { type: "image/png", width: view.getUint32(16), height: view.getUint32(20), orientation: 1 };
  } else if (bytes.length >= 20 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) fail();
    const chunk = text(12, 4);
    const chunkLength = view.getUint32(16, true);
    if (chunkLength > bytes.length - 20) fail();
    if (chunk === "VP8X" && bytes.length >= 30 && chunkLength === 10) {
      if (bytes[20] & 2) fail(); // Animated input is not a single photograph.
      header = { type: "image/webp", width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), orientation: 1 };
    } else if (chunk === "VP8 " && bytes.length >= 30 && chunkLength >= 10) {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) fail();
      header = { type: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, orientation: 1 };
    } else if (chunk === "VP8L" && bytes.length >= 25 && chunkLength >= 5 && bytes[20] === 0x2f) {
      header = { type: "image/webp", width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10), orientation: 1 };
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2; let orientation = 1; let width = 0; let height = 0;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) fail();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) fail();
      const length = view.getUint16(offset); const end = offset + length;
      if (length < 2 || end > bytes.length) fail();
      if (marker === 0xe1 && text(offset + 2, 6) === "Exif\0\0") {
        const start = offset + 8;
        if (start + 8 > end) fail();
        const endian = text(start, 2); if (endian !== "II" && endian !== "MM") fail();
        const little = endian === "II";
        if (view.getUint16(start + 2, little) !== 42) fail();
        const ifd = start + view.getUint32(start + 4, little);
        if (ifd < start + 8 || ifd + 2 > end) fail();
        const count = view.getUint16(ifd, little);
        if (ifd + 2 + count * 12 > end) fail();
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (view.getUint16(entry, little) === 0x112) {
            if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) fail();
            orientation = view.getUint16(entry + 8, little);
            if (orientation < 1 || orientation > 8) fail();
          }
        }
      }
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) fail();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset = end;
    }
    header = { type: "image/jpeg", width, height, orientation };
  }
  if (!header) return fail();
  if (header.width < 1 || header.height < 1 || header.width > limits.maxEncodedWidth || header.height > limits.maxEncodedHeight ||
      header.width * header.height > limits.maxEncodedPixels) fail();
  return header;
}
export function resizedStudyDimensions(header: ImageHeader) {
  const rotated = header.orientation >= 5;
  const width = rotated ? header.height : header.width;
  const height = rotated ? header.width : header.height;
  const scale = Math.min(1, limits.processingLongEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
