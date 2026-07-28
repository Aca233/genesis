export type TransportKind = "stream" | "complete";

export type TransportOutcome =
  | "success"
  | "empty_response"
  | "truncated"
  | "network_terminated"
  | "upstream_timeout"
  | "http_error"
  | "aborted"
  | "unknown_error";

export type TerminalEvidenceType =
  | "response_complete"
  | "stream_eof"
  | "provider_terminal"
  | "cancel_ack"
  | "provider_deadline"
  | "terminal_unknown";

export type TransportFailure = {
  outcome: Exclude<TransportOutcome, "success" | "truncated">;
  terminalEvidence: TerminalEvidenceType;
  stableErrorCode:
    | "EMPTY_RESPONSE"
    | "NETWORK_TERMINATED"
    | "UPSTREAM_TIMEOUT"
    | "HTTP_ERROR"
    | "ABORTED"
    | "UNKNOWN_ERROR";
  errorDetails: string;
};

export type TransportSuccess = {
  outcome: "success" | "truncated";
  terminalEvidence: "response_complete" | "stream_eof";
  stableErrorCode: "OUTPUT_TRUNCATED" | null;
};

const ERROR_DETAILS_LIMIT = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown, message: string): boolean {
  return (error instanceof Error && error.name === "AbortError")
    || /\babort(?:ed|error)?\b/i.test(message);
}

function httpStatus(message: string): number | null {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function boundedPlainText(message: string): string {
  const withoutMarkup = message
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return withoutMarkup.slice(0, ERROR_DETAILS_LIMIT) || "未知模型传输错误";
}

export function classifyTransportFailure(error: unknown): TransportFailure {
  const message = errorMessage(error);

  if (message === "流式响应为空") {
    return {
      outcome: "empty_response",
      terminalEvidence: "stream_eof",
      stableErrorCode: "EMPTY_RESPONSE",
      errorDetails: message,
    };
  }

  if (isAbort(error, message)) {
    return {
      outcome: "aborted",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "ABORTED",
      errorDetails: "模型请求已中止",
    };
  }

  const status = httpStatus(message);
  if (status === 504) {
    return {
      outcome: "upstream_timeout",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "UPSTREAM_TIMEOUT",
      errorDetails: "上游模型服务超时（HTTP 504）",
    };
  }

  if (/fetch failed|terminated|other side closed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|socket|UND_ERR/i.test(message)) {
    return {
      outcome: "network_terminated",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "NETWORK_TERMINATED",
      errorDetails: "模型端点连接中断",
    };
  }

  if (status !== null) {
    return {
      outcome: "http_error",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "HTTP_ERROR",
      errorDetails: /<[^>]+>/.test(message)
        ? `模型端点请求失败（HTTP ${status}）`
        : boundedPlainText(message),
    };
  }

  return {
    outcome: "unknown_error",
    terminalEvidence: "terminal_unknown",
    stableErrorCode: "UNKNOWN_ERROR",
    errorDetails: boundedPlainText(message),
  };
}

export function classifyTransportSuccess(
  kind: TransportKind,
  truncated: boolean,
): TransportSuccess {
  return {
    outcome: truncated ? "truncated" : "success",
    terminalEvidence: kind === "stream" ? "stream_eof" : "response_complete",
    stableErrorCode: truncated ? "OUTPUT_TRUNCATED" : null,
  };
}

/** Keep legacy user-facing errors except where raw provider markup would leak. */
export function safeTransportError(error: unknown): Error {
  const failure = classifyTransportFailure(error);
  const message = errorMessage(error);
  if (failure.outcome === "upstream_timeout" || /<[^>]+>/.test(message)) {
    return new Error(failure.errorDetails);
  }
  return error instanceof Error ? error : new Error(message);
}
