import { describe, expect, it } from "vitest";
import {
  classifyTransportFailure,
  classifyTransportSuccess,
} from "./transport";

describe("LLM transport classification", () => {
  it("classifies an empty stream as an EOF-backed empty response", () => {
    expect(classifyTransportFailure(new Error("流式响应为空"))).toEqual({
      outcome: "empty_response",
      terminalEvidence: "stream_eof",
      stableErrorCode: "EMPTY_RESPONSE",
      errorDetails: "流式响应为空",
    });
  });

  it("classifies a terminated connection without inventing terminal evidence", () => {
    expect(classifyTransportFailure(new Error("terminated"))).toEqual({
      outcome: "network_terminated",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "NETWORK_TERMINATED",
      errorDetails: "模型端点连接中断",
    });
  });

  it("redacts an upstream 504 HTML page", () => {
    const failure = classifyTransportFailure(new Error(
      'HTTP 504: {"error":{"message":"<html><head><title>504 Gateway Time-out</title></head><body>openresty</body></html>"}}',
    ));

    expect(failure).toEqual({
      outcome: "upstream_timeout",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "UPSTREAM_TIMEOUT",
      errorDetails: "上游模型服务超时（HTTP 504）",
    });
    expect(failure.errorDetails).not.toContain("<html>");
    expect(failure.errorDetails).not.toContain("openresty");
  });

  it("classifies aborts separately from network termination", () => {
    expect(classifyTransportFailure(new DOMException("The operation was aborted", "AbortError")))
      .toEqual({
        outcome: "aborted",
        terminalEvidence: "terminal_unknown",
        stableErrorCode: "ABORTED",
        errorDetails: "模型请求已中止",
      });
  });

  it("bounds unknown diagnostics and redacts credential-like values", () => {
    const failure = classifyTransportFailure(new Error(
      `provider exploded authorization=secret-token ${"x".repeat(800)}`,
    ));

    expect(failure.outcome).toBe("unknown_error");
    expect(failure.errorDetails).toContain("authorization=[REDACTED]");
    expect(failure.errorDetails).not.toContain("secret-token");
    expect(failure.errorDetails.length).toBeLessThanOrEqual(500);
  });

  it("marks explicit truncation while preserving stream terminal evidence", () => {
    expect(classifyTransportSuccess("stream", true)).toEqual({
      outcome: "truncated",
      terminalEvidence: "stream_eof",
      stableErrorCode: "OUTPUT_TRUNCATED",
    });
    expect(classifyTransportSuccess("complete", false)).toEqual({
      outcome: "success",
      terminalEvidence: "response_complete",
      stableErrorCode: null,
    });
  });
});
