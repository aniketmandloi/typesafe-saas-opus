import sharp from "sharp";

export const thumbnail = async (input: Buffer, size = 256): Promise<Buffer> =>
  sharp(input).resize(size, size, { fit: "cover" }).webp({ quality: 80 }).toBuffer();

// spike only: gives a caller a valid image without depending on sharp itself
export const solidPng = (size = 64): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 3, background: "#336699" } }).png().toBuffer();
