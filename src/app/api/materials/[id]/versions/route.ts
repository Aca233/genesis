import { NextResponse } from "next/server";
import { z } from "zod";
import { createMaterialVersion } from "@/lib/materials/repository";
import { MaterialVersionContentSchema } from "@/lib/materials/schemas";
import { MaterialDependencySchema } from "@/lib/materials/types";
const Schema = z.object({ name: z.string().trim().min(1).max(80), note: z.string().max(500).optional(), content: MaterialVersionContentSchema, dependencies: z.array(MaterialDependencySchema), parentVersionId: z.string().optional(), setDefault: z.boolean().default(false) }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try { return NextResponse.json({ version: await createMaterialVersion({ cardId: id, ...parsed.data }) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
