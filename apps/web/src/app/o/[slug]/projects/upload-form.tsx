"use client";

import { useState } from "react";

import { createBrowserClient } from "../../../../trpc/browser.ts";

/**
 * Presigned, direct to storage. The bytes never pass through the contract.
 *
 * That is not a preference: Vercel caps request *and* response bodies at
 * 4.5 MB and Lambda at 6 MB, so proxying an upload is not portable across the
 * targets the kit supports (ADR-0004).
 *
 * Under the local profile this signs against the in-memory fake, which serves
 * its own transfer — so the bytes really are sent and really are read back.
 * What the fake still does not reproduce is a *signature*: its expiry is a
 * query parameter rather than signed state, and it grants CORS to every
 * origin, where an S3 bucket grants none until it is configured. An upload
 * that works here can still fail there on preflight.
 */
export const UploadForm = ({ organizationId }: { organizationId: string }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const upload = async (file: File) => {
    setStatus("Uploading");
    setDownloadUrl(null);

    const client = createBrowserClient(organizationId);
    const { upload: row, presigned } = await client.uploads.request.mutate({
      contentType: file.type || "application/octet-stream",
      byteSize: file.size,
      projectId: null,
    });

    // Cross-origin on purpose: the presigned URL names the storage host, not
    // this app's origin, so this request is the one the bucket's CORS
    // configuration has to allow. Routing it through the API rewrite would
    // hide exactly the failure that matters.
    const sent = await fetch(presigned.url, {
      method: presigned.method,
      headers: presigned.headers,
      body: file,
    });
    if (!sent.ok) {
      setStatus(`Upload failed: ${sent.status}`);
      return;
    }

    // Signed from the row rather than from the key the client just used: the
    // procedure reads the row through the TenantDb first, so a download URL
    // exists only for an object this tenant owns.
    const download = await client.uploads.downloadUrl.query({ id: row.id });
    setDownloadUrl(download.url);
    setStatus(`Uploaded ${file.size} bytes`);
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
      {downloadUrl ? <a href={downloadUrl}>Download</a> : null}
    </label>
  );
};
