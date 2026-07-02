import "server-only";

import { BlobServiceClient } from "@azure/storage-blob";

/**
 * Azure Blob Storage for HR file uploads (fingerprint scanner exports).
 *
 * Resources (RG datagami-trackie): storage account `datagamitrackie`, container
 * `attendance-files`. Configured via AZURE_STORAGE_CONNECTION_STRING +
 * AZURE_STORAGE_CONTAINER. Abstracted here so a later swap (e.g. to another
 * provider) touches only this file.
 *
 * Graceful fallback: when the connection string is absent, callers get a clear
 * error only if they actually try to upload — presence can be checked first via
 * `isStorageConfigured()`.
 */
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "attendance-files";

let cachedService: BlobServiceClient | null = null;
function service(): BlobServiceClient {
  const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!cs) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  if (!cachedService) cachedService = BlobServiceClient.fromConnectionString(cs);
  return cachedService;
}

export function isStorageConfigured(): boolean {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

/** Upload bytes and return the blob URL. `pathname` e.g. "uploads/2026-06/report.xls". */
export async function uploadBlob(
  pathname: string,
  data: Buffer | Uint8Array,
  contentType?: string,
): Promise<{ url: string; pathname: string }> {
  const container = service().getContainerClient(CONTAINER);
  await container.createIfNotExists();
  const block = container.getBlockBlobClient(pathname);
  await block.uploadData(data, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });
  return { url: block.url, pathname };
}

/** Download a blob's bytes by pathname. */
export async function downloadBlob(pathname: string): Promise<Buffer> {
  const container = service().getContainerClient(CONTAINER);
  const block = container.getBlockBlobClient(pathname);
  return block.downloadToBuffer();
}

/** Delete a blob (used when a payment/receipt/upload is removed). */
export async function deleteBlob(pathname: string): Promise<void> {
  const container = service().getContainerClient(CONTAINER);
  await container.getBlockBlobClient(pathname).deleteIfExists();
}
