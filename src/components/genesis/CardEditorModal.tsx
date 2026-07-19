"use client";

import { motion, AnimatePresence } from "motion/react";

/** 全屏古卷样式编辑 Modal：卡片全文逐字段编辑的容器 */
export function CardEditorModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(30,24,15,0.45)] p-4 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gilt/30 bg-paper-raised shadow-[0_8px_40px_rgba(30,24,15,0.35)]"
          >
            {/* 卷首 */}
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2
                className="text-xl text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line px-3 py-1 text-sm text-ink-faint transition hover:border-gilt/50 hover:text-gilt"
              >
                合卷
              </button>
            </header>
            {/* 卷身 */}
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-6 py-5">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
