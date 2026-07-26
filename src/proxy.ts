import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * 乐观导航门:未带会话 cookie 的页面导航一律去 /login。
 * 只判断 cookie 存在性(getSessionCookie 自动处理生产 __Secure- 前缀),不验签不查库;
 * 伪造 cookie 只能看到页面外壳,任何数据请求都会被路由内 requireUserId 拦下(401)。
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = Boolean(getSessionCookie(request));

  if (pathname === "/login") {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/", request.url)); // 已登录访问登录页 → 回首页
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const login = new URL("/login", request.url);
    const next = pathname + search;
    if (next !== "/") login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // 排除:/api(API 自带 401 语义,设计文档 §2.2)、Next 静态资源、favicon、所有带扩展名的静态文件(public/ 字体与图片)
  // 注:「带扩展名」用 [.] 而非 \\. —— Next 的 matcher 编译(path-to-regexp)会剥掉 \. 的反斜杠,
  // 使 .*\\..* 退化为 .*..*(匹配一切非空路径,整个 matcher 只剩 /);字符类无转义歧义,两种编译器语义一致。
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*[.].*).*)"],
};
