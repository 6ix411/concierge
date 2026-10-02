/**
 * What a file really is, from its first bytes. The name and the type a browser reports are chosen
 * by whoever sends the file, so uploads are judged by their contents only.
 */

export type SniffedType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "text/plain";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const satisfies SniffedType[];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const satisfies SniffedType[];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"] as const satisfies SniffedType[];

export const extensions: Record<SniffedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

/** How many leading bytes `sniffFileType` needs to judge any supported type. */
export const SNIFF_BYTES = 64 * 1024;

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
const startsWith = (bytes: Uint8Array, ...values: number[]) => values.every((value, i) => bytes[i] === value);

/** Office Open XML (.docx, .xlsx): a zip whose entries name its parts. Macro-enabled files are refused. */
function sniffOffice(bytes: Uint8Array): SniffedType | null {
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.includes("[Content_Types].xml") || /vbaProject|macroEnabled/i.test(text)) return null;
  if (text.includes("word/"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (text.includes("xl/")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return null;
}

/** Plain text: valid UTF-8 with no control characters other than tabs and line breaks. */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  // A UTF-8 character may be cut off at the end of the sample.
  const sample = bytes.length >= SNIFF_BYTES ? bytes.subarray(0, bytes.length - 4) : bytes;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return (
      !/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text) && !/<\s*(script|html|svg|iframe)\b/i.test(text)
    );
  } catch {
    return false;
  }
}

export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heic";
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  if (startsWith(bytes, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return sniffOffice(bytes);
  if (isPlainText(bytes)) return "text/plain";
  return null;
}

/** The file's real type if it is one of `allowed`, otherwise null. */
export function allowedFileType<T extends SniffedType>(bytes: Uint8Array, allowed: readonly T[]): T | null {
  const type = sniffFileType(bytes);
  return type && (allowed as readonly SniffedType[]).includes(type) ? (type as T) : null;
}
