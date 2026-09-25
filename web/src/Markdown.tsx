import { useRef, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { DeployProposal } from './DeploySheet';
import { ImageStrip, ImageViewer } from './ImageView';
import { findImagePaths, imageUrl, isImagePath } from './imagePaths';

function copyText(text: string) {
  // navigator.clipboard needs a secure context; plain-http-over-tailnet is not one.
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/** The text of a fenced block tagged ```roost-deploy, or null. */
function deployBlock(children: unknown): string | null {
  const el = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string; children?: unknown } } | undefined;
  if (!el?.props || !/language-roost-deploy/.test(el.props.className ?? '')) return null;
  const inner = el.props.children;
  return Array.isArray(inner) ? inner.join('') : String(inner ?? '');
}

function Pre(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const deploy = deployBlock(props.children);
  if (deploy != null) return <DeployProposal text={deploy} />;
  return (
    <div className="codeblock">
      <button
        className="copy-btn"
        onClick={() => {
          copyText(ref.current?.innerText ?? '');
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
      <pre ref={ref} {...props} />
    </div>
  );
}

/** An inline `path/to/image.png` is tappable: it opens the viewer. */
function InlineCode(props: ComponentProps<'code'>) {
  const [open, setOpen] = useState(false);
  const text = typeof props.children === 'string' ? props.children : '';
  // Fenced blocks arrive with a language class; only bare inline code is a path.
  if (!props.className && text && isImagePath(text)) {
    return (
      <>
        <button className="img-path" onClick={() => setOpen(true)}>
          <code>{text.trim()}</code>
        </button>
        {open && <ImageViewer path={text.trim()} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return <code {...props} />;
}

function Link(props: ComponentProps<'a'>) {
  const [open, setOpen] = useState(false);
  const href = props.href ?? '';
  if (href.startsWith('/') && isImagePath(href)) {
    return (
      <>
        <a
          {...props}
          href={imageUrl(href)}
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        />
        {open && <ImageViewer path={href} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return <a {...props} target="_blank" rel="noreferrer" />;
}

export function Markdown({ text }: { text: string }) {
  const paths = findImagePaths(text);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: Pre,
          code: InlineCode,
          a: Link,
          // ![alt](/abs/path.png) renders the picture through the viewer route.
          img: ({ src, alt }) => <img className="md-img" src={typeof src === 'string' && src.startsWith('/') ? imageUrl(src) : src} alt={alt ?? ''} />,
        }}
      >
        {text}
      </ReactMarkdown>
      <ImageStrip paths={paths} />
    </div>
  );
}
