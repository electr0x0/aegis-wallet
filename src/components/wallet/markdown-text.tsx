import * as React from "react";

// A small Markdown subset for planner answers: paragraphs, headings, lists,
// **bold**, *italic* and `code`. Model text only ever becomes React text
// nodes, so it cannot inject HTML, and links stay plain text by design.

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "ordered"; start: number; items: string[] }
  | { kind: "bullet"; items: string[] };

const ORDERED_ITEM = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET_ITEM = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
// Bold is tried first so "**x**" never reads as two italics. Underscore
// emphasis is left out: it would mangle tool names like get_wallet_portfolio.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*)/g;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | undefined;
  for (const line of text.split(/\r?\n/)) {
    const ordered = ORDERED_ITEM.exec(line);
    const bullet = BULLET_ITEM.exec(line);
    const heading = HEADING.exec(line);
    if (!line.trim()) {
      open = undefined;
    } else if (ordered) {
      if (open?.kind !== "ordered") {
        open = { kind: "ordered", start: Number(ordered[1]), items: [] };
        blocks.push(open);
      }
      open.items.push(ordered[2]);
    } else if (bullet) {
      if (open?.kind !== "bullet") {
        open = { kind: "bullet", items: [] };
        blocks.push(open);
      }
      open.items.push(bullet[1]);
    } else if (heading) {
      blocks.push({ kind: "heading", text: heading[1] });
      open = undefined;
    } else if (open?.kind === "paragraph") {
      open.lines.push(line);
    } else {
      open = { kind: "paragraph", lines: [line] };
      blocks.push(open);
    }
  }
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    // split() with a capture group puts every match at an odd index.
    if (index % 2 === 0) return part;
    if (part.startsWith("**")) {
      return <strong key={index}>{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <em key={index}>{renderInline(part.slice(1, -1))}</em>;
  });
}

function renderLines(lines: string[]) {
  return lines.map((line, index) => (
    <React.Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line)}
    </React.Fragment>
  ));
}

function renderBlock(block: Block, index: number) {
  switch (block.kind) {
    case "paragraph":
      return <p key={index}>{renderLines(block.lines)}</p>;
    case "heading":
      return (
        <p key={index}>
          <strong>{renderInline(block.text)}</strong>
        </p>
      );
    case "ordered":
      return (
        <ol key={index} start={block.start === 1 ? undefined : block.start}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case "bullet":
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      );
  }
}

export function MarkdownText({ text }: { text: string }) {
  return <>{parseBlocks(text).map(renderBlock)}</>;
}
