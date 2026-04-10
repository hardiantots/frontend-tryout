import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface RichTextRendererProps {
  content: string;
  className?: string;
}

export function RichTextRenderer({ content, className = '' }: RichTextRendererProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-sm max-w-none text-slate-800 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Custom renderers to ensure markdown shapes beautifully without affecting global styles unnecessarily
          p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-2 last:mb-0" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-2 last:mb-0" {...props} />,
          li: ({ node, ...props }) => <li className="mb-1 last:mb-0" {...props} />,
          a: ({ node, ...props }) => (
            <a className="text-teal-600 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
          ),
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !content.includes('\n');
            return isInline ? (
              <code className="px-1.5 py-0.5 rounded bg-slate-100 text-teal-800" {...props}>
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
