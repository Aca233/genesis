import { prisma } from "@/lib/db";
import { TEST_USER_EMAIL, TEST_USER_ID } from "./user-constants";

export * from "./user-constants";

export async function ensureTestUser(
  id: string = TEST_USER_ID,
  email: string = TEST_USER_EMAIL,
): Promise<string> {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name: "测试用户",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}
