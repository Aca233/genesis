import { WorldIcon, type SvgIconData } from "./WorldIcon";

const OPERATIONS = {
  settings: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6a1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1a1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6a1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.36.35.68.6.95c.3.3.7.45 1.1.45h.09a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15\"/>",
  close: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"2\" d=\"m6 6l12 12M18 6L6 18\"/>",
  check: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"m5 12l4 4L19 6\"/>",
  add: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"2\" d=\"M12 5v14M5 12h14\"/>",
} as const;

export type OperationIconName = keyof typeof OPERATIONS;

export function OperationIcon({ name, size = 18 }: { name: OperationIconName; size?: number }) {
  const icon: SvgIconData = { body: OPERATIONS[name], width: 24, height: 24 };
  return <WorldIcon icon={icon} size={size} />;
}
