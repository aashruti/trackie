/**
 * Upload rules for delivery PO documents and payment proofs. The file type is
 * decided from the leading bytes only: the file name and the browser's claimed
 * MIME type are attacker-controlled and ignored.
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const SIGNATURES: { magic: number[]; contentType: string; ext: string }[] = [
  { magic: [0x25, 0x50, 0x44, 0x46], contentType: "application/pdf", ext: "pdf" },
  { magic: [0xff, 0xd8, 0xff], contentType: "image/jpeg", ext: "jpg" },
  { magic: [0x89, 0x50, 0x4e, 0x47], contentType: "image/png", ext: "png" },
];

export function checkUpload(
  bytes: Uint8Array,
  // Deliberately unused: the name never decides the type.
  _fileName: string,
): { ok: true; contentType: string; ext: string } | { ok: false; error: string } {
  void _fileName;
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "That file is larger than 4 MB." };
  const hit = SIGNATURES.find((s) => s.magic.every((b, i) => bytes[i] === b));
  if (!hit) return { ok: false, error: "Only PDF, JPG or PNG files can be uploaded." };
  return { ok: true, contentType: hit.contentType, ext: hit.ext };
}

/** Content-Disposition with an ASCII fallback plus RFC 5987 filename*. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const fallback = fileName.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";
  const encoded = encodeURIComponent(fileName.slice(0, 200)).replace(
    /['()*!]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
