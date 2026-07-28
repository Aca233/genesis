import { createAuthClient } from "better-auth/react";

/** 同源部署，无需 baseURL。 */
export const authClient = createAuthClient();
