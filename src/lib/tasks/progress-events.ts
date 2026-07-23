import { z } from "zod";
import type { TaskKind } from "./progress";

const TaskIdSchema = z.string().trim().min(1);

export const TaskProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    taskId: TaskIdSchema,
    taskKind: z.enum(["chat", "settlement", "rewrite"]),
    stage: z.string().trim().min(1),
    status: z.enum(["running", "completed"]),
    detail: z.string().trim().min(1).optional(),
    occurredAt: z.iso.datetime(),
  }).strict(),
  z.object({
    type: z.literal("text"),
    taskId: TaskIdSchema,
    content: z.string(),
  }).strict(),
  z.object({
    type: z.literal("failed"),
    taskId: TaskIdSchema,
    stage: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("done"),
    taskId: TaskIdSchema,
    followUp: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("settlement"), segmentId: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("rewrite"), taskId: z.string().min(1) }).strict(),
    ]),
  }).strict(),
]);

export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;

const encoder = new TextEncoder();

export function encodeTaskEvent(event: TaskProgressEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(TaskProgressEventSchema.parse(event))}\n\n`);
}

export function progressEvent(
  taskId: string,
  taskKind: TaskKind,
  stage: string,
  status: "running" | "completed",
  detail?: string,
): TaskProgressEvent {
  return TaskProgressEventSchema.parse({
    type: "progress",
    taskId,
    taskKind,
    stage,
    status,
    ...(detail ? { detail } : {}),
    occurredAt: new Date().toISOString(),
  });
}
