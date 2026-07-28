import type { Metadata } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { MotionProvider } from "@/components/theme/MotionProvider";
import { UnauthorizedRedirect } from "@/components/auth/UnauthorizedRedirect";

export const metadata: Metadata = {
  title: "创世",
  description: "一句话创世的神格 AI 叙事游戏——书写你的创世史。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <UnauthorizedRedirect />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
