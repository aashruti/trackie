import { describe, it, expect } from "vitest";
import { MAX_FILE_BYTES, checkUpload, contentDisposition } from "./upload-rules";

const pdf = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46]);
  return b;
};

describe("checkUpload", () => {
  it("enforces the size limit", () => {
    expect(checkUpload(pdf(MAX_FILE_BYTES), "po.pdf").ok).toBe(true);
    expect(checkUpload(pdf(MAX_FILE_BYTES + 1), "po.pdf").ok).toBe(false);
    expect(checkUpload(new Uint8Array(0), "po.pdf").ok).toBe(false);
  });
  it("decides the type from the bytes, not the name", () => {
    expect(checkUpload(new Uint8Array([0x4d, 0x5a, 0, 0]), "fake.pdf").ok).toBe(false);
    expect(checkUpload(pdf(10), "renamed.exe")).toMatchObject({ ok: true, contentType: "application/pdf", ext: "pdf" });
    expect(checkUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "a.bin")).toMatchObject({ ok: true, contentType: "image/jpeg", ext: "jpg" });
    expect(checkUpload(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "a.bin")).toMatchObject({ ok: true, contentType: "image/png", ext: "png" });
  });
});

describe("contentDisposition", () => {
  it("is header-safe for quotes, newlines and non-Latin names", () => {
    const h = contentDisposition('a"b\r\nc.pdf', false);
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toMatch(/^attachment; /);
    expect(contentDisposition("पीओ.pdf", true)).toMatch(/^inline; .*filename\*=UTF-8''/);
    expect(contentDisposition("पीओ.pdf", true)).toMatch(/^[\x20-\x7e]*$/);
  });
});
