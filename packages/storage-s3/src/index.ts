import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage } from "@repo/storage";

export const s3Storage = (config: { bucket: string; region: string }): Storage => {
  const client = new S3Client({ region: config.region });
  return {
    presignUpload: (key, contentType) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }), { expiresIn: 900 }).then((url) => ({ url })),
    presignDownload: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 900 }),
    delete: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
};
