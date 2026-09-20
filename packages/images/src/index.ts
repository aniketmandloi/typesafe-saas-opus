import sharp from "sharp";

export const thumbnail = async (input: Buffer, size = 256): Promise<Buffer> =>
  sharp(input).resize(size, size, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
