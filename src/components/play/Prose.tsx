"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEntityIndex } from "./entity-index";
import { linkifyChildren } from "./EntityLink";

/**
 * 叙事正文 Markdown 渲染（古卷风格）。
 * 模型输出常含 *强调*、**着重**、分隔线、列表等——按书页样式渲染而非裸露星号。
 * 段落/强调内的纯文本节点做实体名匹配 → 微光链接。
 */
export function Prose({ text }: { text: string }) {
  const { patterns } = useEntityIndex();
  const link = (children: React.ReactNode) => linkifyChildren(children, patterns);

  return (
    <div className="prose-scroll leading-loose text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-3">{link(children)}</p>,
          em: ({ children }) => (
            <em className="italic text-ink-soft">{link(children)}</em>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-ink">{link(children)}</strong>
          ),
          hr: () => (
            <p className="my-5 select-none text-center text-sm tracking-[0.4em] text-gilt/50">
              ⁂
            </p>
          ),
          h1: ({ children }) => (
            <h3
              className="my-4 text-xl text-ink"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3
              className="my-4 text-lg text-ink"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4
              className="my-3 text-base font-bold text-ink"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {children}
            </h4>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc pl-6 marker:text-gilt/60">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal pl-6 marker:text-gilt/60">{children}</ol>
          ),
          li: ({ children }) => <li className="my-1">{link(children)}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-gilt/40 pl-4 text-ink-soft">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-paper-sunken px-1 py-0.5 text-sm">
              {children}
            </code>
          ),
          a: ({ children }) => <span className="text-gilt">{children}</span>,
          table: ({ children }) => (
            <table className="my-3 w-full border-collapse text-sm">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-line bg-paper-sunken px-2 py-1 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-line px-2 py-1">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
