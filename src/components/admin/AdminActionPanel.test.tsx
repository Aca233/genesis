import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

const hooks = vi.hoisted(() => {
  const state: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<{ dependencies?: readonly unknown[]; cleanup?: () => void }> = [];
  const pendingEffects: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  return {
    beginRender() {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      pendingEffects.length = 0;
    },
    flushEffects() {
      pendingEffects.splice(0).forEach((run) => run());
    },
    unmount() {
      effects.forEach((effect) => effect.cleanup?.());
      effects.length = 0;
    },
    reset() {
      effects.forEach((effect) => effect.cleanup?.());
      state.length = 0;
      refs.length = 0;
      effects.length = 0;
      pendingEffects.length = 0;
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
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
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = effectIndex++;
      const previous = effects[index];
      const changed = !previous || !dependencies || !previous.dependencies
        || dependencies.length !== previous.dependencies.length
        || dependencies.some((dependency, dependencyIndex) => !Object.is(dependency, previous.dependencies?.[dependencyIndex]));
      if (!changed) return;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: effect() || undefined };
      });
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: hooks.useEffect, useId: hooks.useId, useRef: hooks.useRef, useState: hooks.useState };
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

const taskProps: AdminActionPanelProps = {
  label: "重新执行",
  targetLabel: "创世任务 · 样本世界",
  impact: "保留失败记录，从允许恢复的位置重新开始。",
  payload: { targetType: "task", kind: "genesis", taskId: "task-1", action: "retry" },
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

function findOptionalElement(root: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
  return childrenOf(root).find((node) => {
    if (node === null || typeof node !== "object" || Array.isArray(node) || !("props" in node)) return false;
    return predicate(node as ReactElement<Record<string, unknown>>);
  }) as ReactElement<Record<string, unknown>> | undefined;
}

function renderPanel(props: AdminActionPanelProps = defaultProps) {
  hooks.beginRender();
  const root = AdminActionPanel(props);
  hooks.flushEffects();
  return root;
}

function change(element: ReactElement<Record<string, unknown>>, value: string) {
  (element.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
}

function submit(root: ReactNode) {
  const form = findElement(root, (element) => element.type === "form" && typeof element.props.onSubmit === "function");
  return (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
}

function bindNativeElements(root: ReactNode) {
  const triggerButton = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
  const dialogElement = findElement(root, (element) => element.type === "dialog");
  const reasonElement = findElement(root, (element) => element.type === "textarea" && element.props.name === "reason");
  const confirmationElement = findOptionalElement(root, (element) => element.type === "input" && element.props.name === "confirmation");
  const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
  dialog.showModal.mockImplementation(() => { dialog.open = true; });
  dialog.close.mockImplementation(() => { dialog.open = false; });
  const trigger = { focus: vi.fn() };
  const reason = { focus: vi.fn() };
  const confirmation = { focus: vi.fn() };
  (triggerButton.props.ref as { current: unknown }).current = trigger;
  (dialogElement.props.ref as { current: unknown }).current = dialog;
  if (reasonElement.props.ref) (reasonElement.props.ref as { current: unknown }).current = reason;
  if (confirmationElement?.props.ref) (confirmationElement.props.ref as { current: unknown }).current = confirmation;
  return { triggerButton, dialogElement, dialog, trigger, reason, confirmation };
}

function enterPermanentAction(root: ReactNode, reason = "保留这个原因") {
  change(findElement(root, (element) => element.type === "textarea"), reason);
  change(findElement(root, (element) => element.type === "input" && element.props.name === "confirmation"), "sample@example.com");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function installRefreshScheduler() {
  let frame: FrameRequestCallback | undefined;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const cancelAnimationFrame = vi.fn(() => { frame = undefined; });
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    flushFrame() {
      const callback = frame;
      frame = undefined;
      callback?.(0);
    },
  };
}

describe("AdminActionPanel", () => {
  beforeEach(() => {
    hooks.reset();
    router.refresh.mockReset();
    router.push.mockReset();
    router.replace.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    hooks.unmount();
    vi.useRealTimers();
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

  it("renders one native dialog with a real method=dialog cancel form and native Escape behavior", () => {
    const source = readFileSync(new URL("./AdminActionPanel.tsx", import.meta.url), "utf8");
    const root = renderPanel();
    const dialogs = childrenOf(root).filter((node) => typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node && (node as ReactElement).type === "dialog");
    const cancelForm = findElement(root, (element) => element.type === "form" && element.props.method === "dialog");
    const dialog = findElement(root, (element) => element.type === "dialog");

    expect((root as ReactElement).type).toBe("div");
    expect(dialogs).toHaveLength(1);
    expect(cancelForm.props.onSubmit).toBeUndefined();
    expect(dialog.props.onCancel).toBeUndefined();
    expect(typeof dialog.props.onClose).toBe("function");
    expect(source).toContain("showModal()");
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.alert");
    expect(JSON.stringify(root)).toContain("样本用户 · sample@example.com");
    expect(JSON.stringify(root)).toContain("永久删除账号及其关联元数据，此操作不可撤销。");
  });

  it("restores trigger focus from the native close event used by cancel and Escape", () => {
    const root = renderPanel();
    const { triggerButton, dialogElement, dialog, trigger } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    expect(dialog.showModal).toHaveBeenCalledOnce();

    (dialogElement.props.onClose as () => void)();
    expect(trigger.focus).toHaveBeenCalledOnce();

    trigger.focus.mockClear();
    (dialogElement.props.onClose as () => void)();
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it("keeps invalid values visible and does not request, close, or refresh on client validation failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let root = renderPanel();
    const { triggerButton, dialog, reason } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    enterPermanentAction(root, "a");

    root = renderPanel();
    await submit(root);
    root = renderPanel();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(findElement(root, (element) => element.type === "textarea").props.value).toBe("a");
    expect(findElement(root, (element) => element.type === "input" && element.props.name === "confirmation").props.value).toBe("sample@example.com");
    expect(JSON.stringify(root)).toContain("操作原因至少需要 2 个字");
    expect(reason.focus).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps values and field/form errors visible on an ordinary API failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: "管理操作参数无效",
        fields: { reason: ["操作原因至少需要 2 个字"], confirmation: ["确认文字不匹配"] },
      }),
    }));
    let root = renderPanel();
    const { triggerButton, dialog, reason } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    enterPermanentAction(root);

    root = renderPanel();
    await submit(root);
    root = renderPanel();

    expect(findElement(root, (element) => element.type === "textarea").props.value).toBe("保留这个原因");
    expect(findElement(root, (element) => element.type === "input" && element.props.name === "confirmation").props.value).toBe("sample@example.com");
    expect(JSON.stringify(root)).toContain("管理操作参数无效");
    expect(JSON.stringify(root)).toContain("操作原因至少需要 2 个字");
    expect(JSON.stringify(root)).toContain("确认文字不匹配");
    expect(reason.focus).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("focuses confirmation when the API returns only a confirmation field error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: "管理操作参数无效",
        fields: { confirmation: ["确认文字不匹配"] },
      }),
    }));
    let root = renderPanel();
    const { triggerButton, reason, confirmation } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    enterPermanentAction(root);

    root = renderPanel();
    await submit(root);
    root = renderPanel();

    expect(confirmation.focus).toHaveBeenCalledOnce();
    expect(reason.focus).not.toHaveBeenCalled();
    expect(JSON.stringify(root)).toContain("确认文字不匹配");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["fetch", () => vi.fn().mockRejectedValue(new Error("network failed"))],
    ["response json", () => vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("invalid json")),
    })],
  ])("focuses reason when %s rejects", async (_label, createFetchMock) => {
    vi.stubGlobal("fetch", createFetchMock());
    let root = renderPanel(taskProps);
    const { triggerButton, reason, dialog } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    await submit(root);
    root = renderPanel(taskProps);

    expect(reason.focus).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    expect(JSON.stringify(root)).toContain("操作失败，请稍后重试");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps the dialog, inputs, and conflict error visible without refreshing on 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({ error: "任务状态已经变化，请核对后重试" }),
    }));
    let root = renderPanel();
    const { triggerButton, dialog, reason } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    enterPermanentAction(root, "核对状态冲突");

    root = renderPanel();
    await submit(root);
    root = renderPanel();

    expect(findElement(root, (element) => element.type === "textarea").props.value).toBe("核对状态冲突");
    expect(findElement(root, (element) => element.type === "input" && element.props.name === "confirmation").props.value).toBe("sample@example.com");
    expect(JSON.stringify(root)).toContain("任务状态已经变化，请核对后重试");
    expect(reason.focus).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does not focus a closed dialog when a pending request fails after Escape", async () => {
    const pendingResponse = deferred<{ ok: boolean; status: number; json: () => Promise<{ error: string }> }>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingResponse.promise));
    let root = renderPanel(taskProps);
    const { triggerButton, dialogElement, dialog, reason } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    const request = submit(root);
    root = renderPanel(taskProps);
    dialog.open = false;
    (dialogElement.props.onClose as () => void)();
    pendingResponse.resolve({ ok: false, status: 409, json: async () => ({ error: "任务状态已经变化" }) });
    await request;
    root = renderPanel(taskProps);

    expect(reason.focus).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(JSON.stringify(root)).not.toContain("任务状态已经变化");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("rejects a second session while a request is pending and keeps its stale failure out of the next session", async () => {
    const pendingResponse = deferred<{ ok: boolean; status: number; json: () => Promise<{ error: string }> }>();
    const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    let root = renderPanel(taskProps);
    const { triggerButton, dialogElement, dialog, reason } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    const request = submit(root);
    root = renderPanel(taskProps);
    dialog.open = false;
    (dialogElement.props.onClose as () => void)();
    const busyTrigger = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    expect(busyTrigger.props["aria-disabled"]).toBe(true);
    (busyTrigger.props.onClick as () => void)();
    expect(dialog.showModal).toHaveBeenCalledOnce();

    pendingResponse.resolve({ ok: false, status: 409, json: async () => ({ error: "旧会话失败" }) });
    await request;
    root = renderPanel(taskProps);
    const availableTrigger = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    (availableTrigger.props.onClick as () => void)();
    renderPanel(taskProps);

    expect(dialog.showModal).toHaveBeenCalledTimes(2);
    expect(reason.focus).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(root)).not.toContain("旧会话失败");
  });

  it("prevents a concurrent double submit while exposing the busy state", async () => {
    vi.useFakeTimers();
    const scheduler = installRefreshScheduler();
    const pendingResponse = deferred<{ ok: boolean; status: number; json: () => Promise<{ ok: boolean }> }>();
    const fetchMock = vi.fn().mockReturnValue(pendingResponse.promise);
    vi.stubGlobal("fetch", fetchMock);
    let root = renderPanel(taskProps);
    const { triggerButton, dialog } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    const first = submit(root);
    const second = submit(root);
    root = renderPanel(taskProps);

    expect(fetchMock).toHaveBeenCalledOnce();
    const form = findElement(root, (element) => element.type === "form" && typeof element.props.onSubmit === "function");
    const submitButton = findElement(root, (element) => element.type === "button" && element.props.type === "submit" && typeof element.props.children === "string" && element.props.children === "处理中…");
    expect(form.props["aria-busy"]).toBe(true);
    expect(submitButton.props.disabled).toBe(true);

    pendingResponse.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await Promise.all([first, second]);
    root = renderPanel(taskProps);
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
    scheduler.flushFrame();
    vi.runOnlyPendingTimers();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("closes, announces completion, restores focus, and refreshes without navigation on success", async () => {
    vi.useFakeTimers();
    const scheduler = installRefreshScheduler();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) }));
    let root = renderPanel(taskProps);
    const { triggerButton, dialog, trigger } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    await submit(root);
    expect(router.refresh).not.toHaveBeenCalled();
    root = renderPanel(taskProps);

    expect(dialog.close).toHaveBeenCalledOnce();
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    const status = findElement(root, (element) => element.props.role === "status");
    expect(JSON.stringify(status)).toContain("操作已完成");
    expect(scheduler.requestAnimationFrame).toHaveBeenCalledOnce();

    scheduler.flushFrame();
    expect(router.refresh).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the completed action locked until its single refresh runs", async () => {
    vi.useFakeTimers();
    const scheduler = installRefreshScheduler();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    let root = renderPanel(taskProps);
    const { triggerButton, dialog } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    const submittedRoot = root;
    await submit(submittedRoot);
    root = renderPanel(taskProps);
    const pendingTrigger = findElement(root, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    expect(pendingTrigger.props["aria-disabled"]).toBe(true);

    (pendingTrigger.props.onClick as () => void)();
    await submit(submittedRoot);
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();

    scheduler.flushFrame();
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("clears a queued success timeout when the panel unmounts after the animation frame", async () => {
    vi.useFakeTimers();
    const scheduler = installRefreshScheduler();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) }));
    let root = renderPanel(taskProps);
    const { triggerButton } = bindNativeElements(root);
    (triggerButton.props.onClick as () => void)();
    change(findElement(root, (element) => element.type === "textarea"), "重新排队");

    root = renderPanel(taskProps);
    await submit(root);
    renderPanel(taskProps);
    scheduler.flushFrame();
    expect(vi.getTimerCount()).toBe(1);
    hooks.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.runOnlyPendingTimers();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
