import type { ReactNode } from "react";
import type { Citation } from "../../shared/types";

/**
 * A deliberately small Markdown renderer for the subset the generator emits:
 * headings, paragraphs, lists, blockquotes, tables, bold/italic/code.
 * Small enough to audit, which matters for a document a researcher signs off on.
 */
export function Markdown({ source }: { source: string }): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let list: string[] = [];
  let ordered = false;
  let quote: string[] = [];
  let table: string[][] = [];

  const flushList = () => {
    if (!list.length) return;
    const items = list.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(<blockquote key={blocks.length}>{inline(quote.join(" "))}</blockquote>);
    quote = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...body] = table;
    blocks.push(
      <div className="table-wrap" key={blocks.length}>
        <table className="data">
          <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((row, r) => (
            <tr key={r}>{row.map((c, i) => <td key={i}>{inline(c)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>,
    );
    table = [];
  };
  const flushAll = () => { flushList(); flushQuote(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList(); flushQuote();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (!/^[-: ]+$/.test(cells.join(""))) table.push(cells);
      continue;
    }
    flushTable();

    if (/^\s*[-*]\s+/.test(line)) {
      flushQuote();
      if (ordered) flushList();
      ordered = false;
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushQuote();
      if (!ordered && list.length) flushList();
      ordered = true;
      list.push(line.replace(/^\s*\d+[.)]\s+/, ""));
      continue;
    }
    flushList();

    if (/^>\s?/.test(line)) { quote.push(line.replace(/^>\s?/, "")); continue; }
    flushQuote();

    if (!line.trim()) continue;
    if (/^####\s+/.test(line)) blocks.push(<h4 key={blocks.length}>{inline(line.slice(5))}</h4>);
    else if (/^###\s+/.test(line)) blocks.push(<h3 key={blocks.length}>{inline(line.slice(4))}</h3>);
    else if (/^##\s+/.test(line)) blocks.push(<h3 key={blocks.length}>{inline(line.slice(3))}</h3>);
    else if (/^#\s+/.test(line)) blocks.push(<h3 key={blocks.length}>{inline(line.slice(2))}</h3>);
    else if (/^(---|\*\*\*|___)\s*$/.test(line)) blocks.push(<hr key={blocks.length} />);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flushAll();

  return <>{blocks}</>;
}

/** Bold, italic and inline code. Split on the whole set at once so nesting order is stable. */
function inline(text: string): ReactNode {
  // Underscore italics only count on a word boundary, so snake_case variable names
  // like `veiligheid_score` in the same sentence are never mistaken for emphasis.
  const parts = text
    .split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|`[^`]+`|(?<![A-Za-z0-9_])_[^_]+_(?![A-Za-z0-9_]))/g)
    .filter(Boolean);
  return parts.map((part, i) => {
    if (/^\*\*.+\*\*$/.test(part) || /^__.+__$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*.+\*$/.test(part) || /^_.+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`.+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

export function CitationChips({ citations }: { citations: Citation[] }): ReactNode {
  if (!citations.length) {
    return <span className="badge amber"><i className="dot" />No source reference</span>;
  }
  return (
    <div className="row tight">
      {citations.map((c, i) => (
        <span className="cite-chip" key={`${c.evidence_id}-${i}`} title={`"${c.cited_text}"`}>
          {c.kind === "finding" ? "F" : "T"} · {c.label}
        </span>
      ))}
    </div>
  );
}
