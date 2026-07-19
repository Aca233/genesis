import crypto from "node:crypto";

/**
 * API Key 加密（AES-256-GCM）。
 * 密钥来自环境变量 SECRET_KEY（32 字节 hex）。密文格式：iv:tag:data（hex）。
 */

function getKey(): Buffer {
  const hex = process.env.SECRET_KEY;
  if (!hex || hex === "replace-me") {
    throw new Error("SECRET_KEY 未配置：请在 .env 中设置 32 字节 hex 密钥");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("SECRET_KEY 必须是 32 字节 hex（64 个 hex 字符）");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("hex")}`;
}

export function decryptSecret(encrypted: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("密文格式无效");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
