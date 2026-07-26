"use client";

import { MotionConfig } from "motion/react";

/**
 * 动效基座：让 motion 体系全局尊重系统「减弱动态效果」偏好。
 * reducedMotion="user" 时，motion/react 的 transform/layout 动画自动降级为瞬时切换。
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
