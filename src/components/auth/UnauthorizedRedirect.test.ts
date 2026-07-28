import { describe, expect, it } from "vitest";
import { shouldRedirectOn401 } from "./UnauthorizedRedirect";

const ORIGIN = "http://localhost:3000";

describe("shouldRedirectOn401", () => {
  it.each([
    ["/api/worlds", "/archives", true],
    ["/api/worlds", "/login", false],
    ["/api/auth/sign-in/email", "/", false],
    ["/api/auth/get-session", "/settings", false],
    ["http://localhost:3000/api/worlds", "/", true],
    ["https://evil.example/api/worlds", "/", false],
    ["/images/x.png", "/", false],
  ])("%s @ %s => %s", (url, path, expected) => {
    expect(shouldRedirectOn401(url, path, ORIGIN)).toBe(expected);
  });
});
