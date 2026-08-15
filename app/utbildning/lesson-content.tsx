/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";

type LessonBlock = {
  type?:
    | "text"
    | "richtext"
    | "heading"
    | "list"
    | "table"
    | "link"
    | "embed"
    | "image"
    | "video"
    | "document"
    | "callout";
  text?: string;
  url?: string;
  title?: string;
  tone?: "info" | "warning";
};

export default function LessonContent({ bodyJson }: { bodyJson: string }) {
  let body: {
    text?: string;
    content?: string;
    imageUrl?: string;
    videoUrl?: string;
    documentUrl?: string;
    blocks?: LessonBlock[];
  } = {};
  try {
    body = JSON.parse(bodyJson) as typeof body;
  } catch {
    body = { text: bodyJson };
  }
  const blocks = body.blocks ?? [
    ...(body.text || body.content
      ? [{ type: "text" as const, text: body.text ?? body.content }]
      : []),
    ...(body.imageUrl ? [{ type: "image" as const, url: body.imageUrl }] : []),
    ...(body.videoUrl ? [{ type: "video" as const, url: body.videoUrl }] : []),
    ...(body.documentUrl
      ? [
          {
            type: "document" as const,
            url: body.documentUrl,
            title: "Öppna dokument",
          },
        ]
      : []),
  ];
  return (
    <div className="lesson-content">
      {blocks.length ? (
        blocks.map((block, index) => (
          <LessonBlockView block={block} key={`${block.type}-${index}`} />
        ))
      ) : (
        <p>Det här momentet saknar publicerat innehåll.</p>
      )}
    </div>
  );
}

function LessonBlockView({ block }: { block: LessonBlock }) {
  if (block.type === "heading")
    return (
      <h2 className="lesson-heading">{block.text ?? block.title ?? ""}</h2>
    );
  if (block.type === "list")
    return (
      <ul className="lesson-list">
        {(block.text ?? "")
          .split(/\r?\n/)
          .map((item, index) =>
            item.trim() ? <li key={index}>{item.trim()}</li> : null,
          )}
      </ul>
    );
  if (block.type === "table") return <LessonTable value={block.text ?? ""} />;
  if (block.type === "link" && block.url && isSafeHttpUrl(block.url))
    return (
      <p>
        <a
          className="lesson-link"
          href={block.url}
          target="_blank"
          rel="noreferrer"
        >
          {block.title || block.text || block.url} <span>↗</span>
        </a>
      </p>
    );
  if (block.type === "embed" && block.url && isSafeHttpUrl(block.url))
    return (
      <div className="lesson-video">
        <iframe
          src={block.url}
          title={block.title ?? "Inbäddat material"}
          allow="fullscreen"
          loading="lazy"
        />
      </div>
    );
  if (block.type === "image" && block.url && isSafeMediaUrl(block.url))
    return (
      <figure className="lesson-media">
        <img src={block.url} alt={block.title ?? "Kursbild"} />
        <figcaption>{block.title}</figcaption>
      </figure>
    );
  if (block.type === "video" && block.url && isSafeMediaUrl(block.url))
    return isEmbeddableVideo(block.url) ? (
      <div className="lesson-video">
        <iframe
          src={embedVideoUrl(block.url)}
          title={block.title ?? "Kursvideo"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    ) : (
      <video className="lesson-video" controls preload="metadata" src={block.url}>
        Din webbläsare kan inte spela upp videon.
      </video>
    );
  if (block.type === "document" && block.url && isSafeMediaUrl(block.url))
    return (
      <a
        className="lesson-document"
        href={block.url}
        target="_blank"
        rel="noreferrer"
      >
        {block.title ?? "Öppna dokument"} <span>↗</span>
      </a>
    );
  if (block.type === "callout")
    return (
      <aside
        className={`lesson-callout ${block.tone === "warning" ? "warning" : ""}`}
      >
        {block.text}
      </aside>
    );
  if (block.type === "richtext") return <RichText value={block.text ?? ""} />;
  return <p>{block.text ?? ""}</p>;
}

function RichText({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);
  const output: ReactNode[] = [];
  let list: string[] = [];

  function flushList() {
    if (!list.length) return;
    output.push(
      <ul className="lesson-list" key={`list-${output.length}`}>
        {list.map((item, index) => <li key={index}>{inlineMarkup(item)}</li>)}
      </ul>,
    );
    list = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      list.push(listItem[1]);
      continue;
    }
    flushList();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      output.push(<h3 className="lesson-heading" key={`heading-${output.length}`}>{inlineMarkup(heading[2])}</h3>);
    } else {
      output.push(<p key={`paragraph-${output.length}`}>{inlineMarkup(trimmed)}</p>);
    }
  }
  flushList();
  return <div className="lesson-richtext">{output}</div>;
}

function inlineMarkup(value: string): ReactNode[] {
  const tokens = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((?:https?:\/\/)[^)]+\))/g;
  return value.split(tokens).filter(Boolean).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**"))
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("*") && token.endsWith("*"))
      return <em key={index}>{token.slice(1, -1)}</em>;
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link)
      return <a className="lesson-link" href={link[2]} target="_blank" rel="noreferrer" key={index}>{link[1]} <span>↗</span></a>;
    return <span key={index}>{token}</span>;
  });
}

function LessonTable({ value }: { value: string }) {
  const rows = parseTableRows(value);
  if (rows)
    return (
      <div className="lesson-table-wrap">
        <table>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{String(cell ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return <p>{value}</p>;
}

function parseTableRows(value: string): unknown[][] | null {
  try {
    const rows = JSON.parse(value) as unknown;
    if (Array.isArray(rows) && rows.every((row) => Array.isArray(row)))
      return rows as unknown[][];
  } catch {
    /* Fall back to readable text for older/imported content. */
  }
  return null;
}

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isSafeMediaUrl(value: string) {
  return value.startsWith("/api/course-assets/") || value.startsWith("/brand/") || isSafeHttpUrl(value);
}

function isEmbeddableVideo(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes("youtube.com") || hostname === "youtu.be" || hostname.includes("vimeo.com");
  } catch {
    return false;
  }
}

function embedVideoUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com"))
      return `https://www.youtube.com/embed/${parsed.searchParams.get("v") ?? ""}`;
    if (parsed.hostname === "youtu.be")
      return `https://www.youtube.com/embed${parsed.pathname}`;
    if (parsed.hostname.includes("vimeo.com"))
      return `https://player.vimeo.com/video${parsed.pathname}`;
  } catch {
    return url;
  }
  return url;
}
