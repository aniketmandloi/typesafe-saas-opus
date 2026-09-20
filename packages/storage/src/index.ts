export interface Storage {
  presignUpload(key: string, contentType: string): Promise<{ url: string; fields?: Record<string, string> }>;
  presignDownload(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
