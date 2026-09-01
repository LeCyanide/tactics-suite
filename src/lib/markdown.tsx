import type { ReactNode } from 'react';

/**
 * Minimal Markdown renderer for tactical notes.
 *
 * Deliberately hand-written and returning React nodes rather than HTML: notes
 * are plain text the user types, and building elements directly means there is
 * never a `dangerouslySetInnerHTML` in the application at all.
 *
 * Supported: `#`/`##`/`###` headings, `-`/`*`/`•` bullets, `- [ ]` and `- [x]`
 * checklists, `**bold**`, `*italic*`, `` `code` ``, blank-line paragraphs.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over the three inline markers, longest first.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`ul${key++}`}>{list}</ul>);
    list = [];
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    blocks.push(<p key={`p${key++}`}>{inline(text, `p${key}`)}</p>);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
      blocks.push(<Tag key={`h${key++}`}>{inline(heading[2], `h${key}`)}</Tag>);
      continue;
    }

    const task = /^[-*•]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (task) {
      flushParagraph();
      const done = task[1].toLowerCase() === 'x';
      list.push(
        <li key={`t${key++}`} className="task">
          <span className="box">{done ? '✓' : ''}</span>
          <span style={done ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
            {inline(task[2], `t${key}`)}
          </span>
        </li>,
      );
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(<li key={`b${key++}`}>{inline(bullet[1], `b${key}`)}</li>);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return <>{blocks}</>;
}
