export const GENESIS_CREATE_MAX_BYTES = 512 * 1024;
export const GENESIS_MODEL_INPUT_MAX_BYTES = 256 * 1024;
export const GENESIS_MODEL_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
export const GENESIS_RAW_MAX_BYTES = GENESIS_MODEL_OUTPUT_MAX_BYTES;
export const GENESIS_NORMALIZED_MAX_BYTES = 2 * 1024 * 1024;
export const GENESIS_VALIDATION_MAX_BYTES = 16 * 1024;
export const GENESIS_RAW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function takeUtf8Prefix(value: string, limitBytes: number): string {
  if (limitBytes <= 0) return "";
  if (utf8Bytes(value) <= limitBytes) return value;

  let result = "";
  let used = 0;
  for (const codePoint of value) {
    const bytes = utf8Bytes(codePoint);
    if (used + bytes > limitBytes) break;
    result += codePoint;
    used += bytes;
  }
  return result;
}

export class PayloadLimitError extends Error {
  readonly code: "INPUT_LIMIT_EXCEEDED" | "OUTPUT_LIMIT_EXCEEDED";
  readonly observedBytes: number;
  readonly limitBytes: number;
  readonly boundedPrefix: string;

  constructor(
    code: "INPUT_LIMIT_EXCEEDED" | "OUTPUT_LIMIT_EXCEEDED",
    observedBytes: number,
    limitBytes: number,
    boundedPrefix = "",
  ) {
    const subject = code === "INPUT_LIMIT_EXCEEDED" ? "模型输入" : "模型输出";
    super(`${subject}超过安全上限（已读取 ${observedBytes} 字节，上限 ${limitBytes} 字节）`);
    this.name = "PayloadLimitError";
    this.code = code;
    this.observedBytes = observedBytes;
    this.limitBytes = limitBytes;
    this.boundedPrefix = boundedPrefix;
  }
}

export async function readUtf8Body(request: Request, limitBytes: number): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new PayloadLimitError("INPUT_LIMIT_EXCEEDED", contentLength, limitBytes);
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let observedBytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      observedBytes += value.byteLength;
      if (observedBytes > limitBytes) {
        await reader.cancel();
        throw new PayloadLimitError("INPUT_LIMIT_EXCEEDED", observedBytes, limitBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof PayloadLimitError) throw error;
    throw new Error("创世请求不是有效的 UTF-8 文本");
  } finally {
    reader.releaseLock();
  }
}
