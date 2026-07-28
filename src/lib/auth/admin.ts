import "server-only";
import { headers } from "next/headers";
import { auth } from "./index";
import { prisma } from "../db";
import { NextResponse } from "next/server";

export class AdminUnauthorizedError extends Error {
  constructor() {
    super("未登录或会话已过期");
    this.name = "AdminUnauthorizedError";
  }
}

export class AdminForbiddenError extends Error {
  constructor() {
    super("无管理权限");
    this.name = "AdminForbiddenError";
  }
}

export type AdminPrincipal = { id: string; name: string; email: string };

export async function requireAdmin(): Promise<AdminPrincipal> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AdminUnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, banned: true },
  });
  if (!user || user.role !== "admin" || user.banned === true) throw new AdminForbiddenError();
  return { id: user.id, name: user.name, email: user.email };
}

export function withAdmin<C>(handler: (admin: AdminPrincipal, request: Request, context: C) => Promise<Response>) {
  return async (request: Request = new Request("http://localhost"), context?: C) => {
    try {
      return await handler(await requireAdmin(), request, context as C);
    } catch (error) {
      if (error instanceof AdminUnauthorizedError) return NextResponse.json({ error: error.message }, { status: 401 });
      if (error instanceof AdminForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
      throw error;
    }
  };
}
