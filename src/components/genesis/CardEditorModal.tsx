"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { OperationIcon } from "@/components/icons/OperationIcon";

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
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc 合卷（仅 open 时挂载监听）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // 展卷时将焦点移入对话框（合卷按钮）
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-editor-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="tome-plate flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
          >
            {/* 卷首：泥金章题 + 合卷钮 */}
            <header className="flex items-center gap-4 border-b border-line px-6 py-4">
              <h2
                id="card-editor-title"
                className="illuminated-header display-md min-w-0 flex-1"
              >
                <span className="illuminated-header__glyph" aria-hidden="true">
                  <OperationIcon name="scroll" size={18} />
                </span>
                <span className="min-w-0 truncate">{title}</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md border border-line px-3 py-1 text-sm text-ink-faint transition hover:border-gilt/50 hover:text-gilt"
              >
                合卷
              </button>
            </header>
            {/* 卷身 */}
            <div className="tome-scroll grid flex-1 content-start gap-4 overflow-y-auto px-6 py-5">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
