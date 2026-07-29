import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

const hooks = vi.hoisted(() => {
  const state: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  return {
    beginRender() {
      stateIndex = 0;
      refIndex = 0;
    },
    reset() {
      state.length = 0;
      refs.length = 0;
      stateIndex = 0;
      refIndex = 0;
    },
    useState<T>(initial: T | (() => T)) {
      const index = stateIndex++;
      if (index >= state.length) state[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      const setState = (value: T | ((current: T) => T)) => {
        state[index] = typeof value === "function" ? (value as (current: T) => T)(state[index] as T) : value;
      };
      return [state[index] as T, setState] as const;
    },
    useId() { return "admin-action-panel-test"; },
    useRef<T>(initial: T) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index] as { current: T };
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useId: hooks.useId, useRef: hooks.useRef, useState: hooks.useState };
});

import { AdminActionPanel, type AdminActionPanelProps } from "./AdminActionPanel";

const defaultProps: AdminActionPanelProps = {
  label: "永久删除",
  targetLabel: "样本用户 · sample@example.com",
  impact: "永久删除账号及其关联元数据，此操作不可撤销。",
  confirmationLabel: "sample@example.com",
  danger: true,
  payload: { targetType: "user", targetUserId: "user-1", action: "delete" },
};

function childrenOf(node: ReactNode): ReactNode[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(childrenOf);
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [node, ...childrenOf(element.props?.children)];
}

function findElement(root: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
  const match = childrenOf(root).find((node) => {
    if (node === null || typeof node !== "object" || Array.isArray(node) || !("props" in node)) return false;
    return predicate(node as ReactElement<Record<string, unknown>>);
  });
  if (!match) throw new Error("element not found");
  return match as ReactElement<Record<string, unknown>>;
}

function renderPanel(props: AdminActionPanelProps = defaultProps) {
  hooks.beginRender();
  return AdminActionPanel(props);
}

function change(element: ReactElement<Record<string, unknown>>, value: string) {
  (element.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
}

async function submit(root: ReactNode) {
  const form = findElement(root, (element) => element.type === "form" && typeof element.props.onSubmit === "function");
  await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
}

describe("AdminActionPanel", () => {
  beforeEach(() => {
    hooks.reset();
    router.refresh.mockReset();
    router.push.mockReset();
    router.replace.mockReset();
    vi.unstubAllGlobals();
  });

  it("has responsive dialog sizing and visible keyboard focus styles", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".admin-action-dialog::backdrop");
    expect(css).toContain(".admin-action-dialog__submit:focus-visible");
    expect(css).toContain(".admin-action-panel__trigger:focus-visible");
    expect(css).toContain("max-inline-size: min(42rem, calc(100vw - 2rem))");
    expect(css).toContain("@media (max-width: 640px)");
  });

  it("renders one native dialog with a real method=dialog cancel form and no browser prompts", () => {
    const source = readFileSync(new URL("./AdminActionPanel.tsx", import.meta.url), "utf8");
    const root = renderPanel();
    const dialogs = childrenOf(root).filter((node) => typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node && (node as ReactElement).type === "dialog");
    const cancelForm = findElement(root, (element) => element.type === "form" && element.props.method === "dialog");

    expect((root as ReactElement).type).toBe("div");
    expect(dialogs).toHaveLength(1);
    expect(cancelForm.props.onSubmit).toBeUndefined();
    expect(source).toContain("showModal()");
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.alert");
    expect(JSON.stringify(root)).toContain("样本用户 · sample@example.com");
    expect(JSON.stringify(root)).toContain("永久删除账号及其关联元数据，此操作不可撤销。");
  });

  it("keeps reason and confirmation values while surfacing API field and form errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: "管理操作参数无效",
        fields: { reason: ["操作原因至少需要 2 个字"], confirmation: ["确认文字不匹配"] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const trigger = { focus: vi.fn() };

    let root = renderPanel();
    const triggerButton = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    const dialogElement = findElement(root, (element) => element.type === "dialog");
    (triggerButton.props.ref as { current: unknown }).current = trigger;
    (dialogElement.props.ref as { current: unknown }).current = dialog;
    (triggerButton.props.onClick as () => void)();

    root = renderPanel();
    change(findElement(root, (element) => element.type === "textarea"), "保留这个原因");
    change(findElement(root, (element) => element.type === "input" && element.props.name === "confirmation"), "sample@example.com");
    root = renderPanel();
    await submit(root);
    root = renderPanel();

    const reason = findElement(root, (element) => element.type === "textarea");
    const confirmation = findElement(root, (element) => element.type === "input" && element.props.name === "confirmation");
    expect(reason.props.value).toBe("保留这个原因");
    expect(confirmation.props.value).toBe("sample@example.com");
    expect(JSON.stringify(root)).toContain("管理操作参数无效");
    expect(JSON.stringify(root)).toContain("操作原因至少需要 2 个字");
    expect(JSON.stringify(root)).toContain("确认文字不匹配");
    expect(dialog.close).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("closes, announces completion, restores focus, and refreshes without navigation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) }));
    const dialog = { showModal: vi.fn(), close: vi.fn() };
    const trigger = { focus: vi.fn() };

    let root = renderPanel({ ...defaultProps, confirmationLabel: undefined, payload: { targetType: "task", kind: "genesis", taskId: "task-1", action: "retry" } });
    const triggerButton = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    const dialogElement = findElement(root, (element) => element.type === "dialog");
    (triggerButton.props.ref as { current: unknown }).current = trigger;
    (dialogElement.props.ref as { current: unknown }).current = dialog;
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel({ ...defaultProps, confirmationLabel: undefined, payload: { targetType: "task", kind: "genesis", taskId: "task-1", action: "retry" } });
    await submit(root);
    root = renderPanel({ ...defaultProps, confirmationLabel: undefined, payload: { targetType: "task", kind: "genesis", taskId: "task-1", action: "retry" } });

    expect(dialog.close).toHaveBeenCalledOnce();
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    const status = findElement(root, (element) => element.props.role === "status");
    expect(JSON.stringify(status)).toContain("操作已完成");
  });
});
