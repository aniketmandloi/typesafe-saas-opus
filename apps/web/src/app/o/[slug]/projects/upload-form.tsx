"use client";

import { useState } from "react";

import { createBrowserClient } from "../../../../trpc/browser.ts";

/**
 * Presigned, direct to storage. The bytes never pass through the server.
 *
 * That is not a preference: Vercel caps request *and* response bodies at
 * 4.5 MB and Lambda at 6 MB, so proxying an upload is not portable across the
 * targets the kit supports (ADR-0004).
 *
 * Under the local profile this signs against the in-memory fake, whose URL is a
 * `memory://` scheme the browser cannot PUT to. The request half is therefore
 * real and the transfer half is not — the fake also enforces no expiry, no CORS
 * and no content-type check, so passing here does not mean passing against S3.
 */
export const UploadForm = ({ organizationId }: { organizationId: string }) => {
  const [status, setStatus] = useState<string | null>(null);

  const upload = async (file: File) => {
    const client = createBrowserClient(organizationId);
    const { presigned } = await client.uploads.request.mutate({
      contentType: file.type || "application/octet-stream",
      byteSize: file.size,
      projectId: null,
    });

    setStatus(`Presigned ${presigned.method} to ${new URL(presigned.url).protocol}`);

    if (!presigned.url.startsWith("http")) return;
    await fetch(presigned.url, {
      method: presigned.method,
      headers: presigned.headers,
      body: file,
    });
    setStatus("Uploaded");
  };

  return (
    <label>
      Upload a file
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {status ? <p>{status}</p> : null}
    </label>
  );
};
