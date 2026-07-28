import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveIcon } from "@/lib/icons/resolver";
import { loadLocalIcon } from "@/lib/icons/svg.server";
import { parseWorldIconTheme } from "@/lib/icons/theme";
import {
  assertIconSubjectOwnership,
  restoreAutomaticIcon,
  setPlayerIconAssignment,
  type IconAssignmentTx,
  type IconSubjectOwnershipClient,
} from "@/lib/icons/assignment";
import { withAuth } from "@/lib/auth/route";
import { requireWorld } from "@/lib/auth/ownership";

const SubjectTypeSchema = z.enum(["entity", "god", "ability", "event"]);
const SubjectSchema = z.object({
  timelineId: z.string().trim().min(1).max(512),
  subjectType: SubjectTypeSchema,
  subjectId: z.string().trim().min(1).max(512),
}).strict();
const PutSchema = SubjectSchema.extend({
  token: z.string().trim().min(1).max(160),
}).strict();

async function validateSubject(
  worldId: string,
  subject: z.infer<typeof SubjectSchema>,
) {
  await assertIconSubjectOwnership(
    prisma as unknown as IconSubjectOwnershipClient,
    { worldId, ...subject },
  );
}

async function assignmentResponse(
  worldId: string,
  subject: z.infer<typeof SubjectSchema>,
  assignment: Awaited<ReturnType<typeof setPlayerIconAssignment>>,
) {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: { iconTheme: true },
  });
  if (!world) throw new Error("世界不存在");
  const resolved = resolveIcon({
    theme: parseWorldIconTheme(world.iconTheme),
    token: assignment.token,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    override: assignment,
  });
  return {
    ...assignment,
    token: resolved.token,
    icon: loadLocalIcon(resolved.id),
  };
}

export const PUT = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = PutSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "图标分配请求无效" }, { status: 400 });
  try {
    if (await requireWorld(userId, id) === null) {
      return NextResponse.json({ error: "世界不存在" }, { status: 404 });
    }
    await validateSubject(id, body.data);
    const assignment = await setPlayerIconAssignment(
      prisma as unknown as IconAssignmentTx,
      body.data,
    );
    return NextResponse.json({
      assignment: await assignmentResponse(id, body.data, assignment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});

export const DELETE = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = SubjectSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "图标恢复请求无效" }, { status: 400 });
  try {
    if (await requireWorld(userId, id) === null) {
      return NextResponse.json({ error: "世界不存在" }, { status: 404 });
    }
    await validateSubject(id, body.data);
    const assignment = await restoreAutomaticIcon(
      prisma as unknown as IconAssignmentTx,
      { worldId: id, ...body.data },
    );
    return NextResponse.json({
      assignment: await assignmentResponse(id, body.data, assignment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
