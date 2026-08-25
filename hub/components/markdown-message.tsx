import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ content }: { content: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
      pre: ({ children }) => <div className="code-wrap"><button type="button" onClick={(event) => {
        const code = event.currentTarget.parentElement?.querySelector("code")?.textContent || "";
        navigator.clipboard.writeText(code);
        event.currentTarget.textContent = "Copiado";
        setTimeout(() => { event.currentTarget.textContent = "Copiar"; }, 1200);
      }}>Copiar</button><pre>{children}</pre></div>
    }}
  >{content}</ReactMarkdown>;
}
