import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ className, ...p }) => <h1 className={cn("text-base font-semibold mt-3 first:mt-0 mb-1.5", className)} {...p} />,
  h2: ({ className, ...p }) => <h2 className={cn("text-sm font-semibold mt-3 first:mt-0 mb-1.5", className)} {...p} />,
  h3: ({ className, ...p }) => <h3 className={cn("text-sm font-semibold mt-3 first:mt-0 mb-1", className)} {...p} />,
  h4: ({ className, ...p }) => <h4 className={cn("text-sm font-medium mt-2 first:mt-0 mb-1", className)} {...p} />,
  p: ({ className, ...p }) => <p className={cn("my-1.5 first:mt-0 last:mb-0", className)} {...p} />,
  ul: ({ className, ...p }) => <ul className={cn("list-disc pl-5 my-1.5 space-y-0.5", className)} {...p} />,
  ol: ({ className, ...p }) => <ol className={cn("list-decimal pl-5 my-1.5 space-y-0.5", className)} {...p} />,
  li: ({ className, ...p }) => <li className={cn("[&>p]:my-0", className)} {...p} />,
  a: ({ className, ...p }) => <a className={cn("text-primary underline underline-offset-2 hover:no-underline", className)} target="_blank" rel="noreferrer noopener" {...p} />,
  code: ({ className, children, ...p }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className={cn("font-mono text-xs", className)} {...p}>{children}</code>;
    }
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p}>{children}</code>;
  },
  pre: ({ className, ...p }) => <pre className={cn("rounded-md bg-muted p-3 my-2 overflow-x-auto text-xs", className)} {...p} />,
  blockquote: ({ className, ...p }) => <blockquote className={cn("border-l-2 border-muted-foreground/30 pl-3 my-2 text-muted-foreground", className)} {...p} />,
  table: ({ className, ...p }) => <div className="my-2 overflow-x-auto"><table className={cn("w-full border-collapse text-xs", className)} {...p} /></div>,
  th: ({ className, ...p }) => <th className={cn("border border-border px-2 py-1 text-left font-medium", className)} {...p} />,
  td: ({ className, ...p }) => <td className={cn("border border-border px-2 py-1 align-top", className)} {...p} />,
  hr: ({ className, ...p }) => <hr className={cn("my-3 border-border", className)} {...p} />,
  strong: ({ className, ...p }) => <strong className={cn("font-semibold", className)} {...p} />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
