import fs from "fs";
import path from "path";

function escMd(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false, codeLang = "", codeAcc: string[] = [];
  let inList = false, listTag = "";
  let tableAcc: string[] = [], inTable = false;
  const slugCounts = new Map<string, number>();

  function inline(s: string): string {
    const codes: string[] = [];
    s = s.replace(/`([^`]+)`/g, (_: string, m: string) => {
      codes.push(m);
      return `\x01${codes.length - 1}\x02`;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\x01(\d+)\x02/g, (_: string, i: string) => `<code>${codes[+i]}</code>`);
  }

  function makeId(rawText: string): string {
    const base = rawText
      .replace(/`[^`]*`/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "section";
    const n = slugCounts.get(base) ?? 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  }

  function flushList(): void {
    if (inList) {
      out.push(`</${listTag}>`);
      inList = false;
      listTag = "";
    }
  }

  function flushTable(): void {
    if (!inTable || tableAcc.length === 0) return;
    inTable = false;
    const rows = [...tableAcc];
    tableAcc = [];
    if (rows.length < 2) return;
    const parseRow = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const headers = parseRow(rows[0]);
    let html = "<table><thead><tr>" + headers.map((h) => `<th>${inline(escMd(h))}</th>`).join("") + "</tr></thead>";
    const body = rows.slice(2).filter((r) => r.trim() && !/^\s*\|?[-|: ]+\|?\s*$/.test(r));
    if (body.length) {
      html += "<tbody>" + body.map((r) => "<tr>" + parseRow(r).map((c) => `<td>${inline(escMd(c))}</td>`).join("") + "</tr>").join("") + "</tbody>";
    }
    out.push(html + "</table>");
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code class="language-${codeLang}">${escMd(codeAcc.join("\n").trimEnd())}</code></pre>`);
        inCode = false;
        codeLang = "";
        codeAcc = [];
      } else {
        flushList();
        flushTable();
        inCode = true;
        codeLang = line.slice(3).trim() || "text";
      }
      continue;
    }
    if (inCode) {
      codeAcc.push(line);
      continue;
    }

    if (line.trim().startsWith("|") && line.includes("|", 2)) {
      flushList();
      tableAcc.push(line);
      inTable = true;
      continue;
    }
    if (inTable && !line.trim().startsWith("|")) flushTable();

    const hm = line.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      flushList();
      const level = hm[1].length;
      const rawText = hm[2].trim();
      out.push(`<h${level} id="${makeId(rawText)}">${inline(escMd(rawText))}</h${level}>`);
      continue;
    }
    if (/^[-*_]{3,}$/.test(line.trim())) {
      flushList();
      out.push("<hr>");
      continue;
    }
    if (line.startsWith("> ")) {
      flushList();
      out.push(`<blockquote><p>${inline(escMd(line.slice(2)))}</p></blockquote>`);
      continue;
    }

    const ulm = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulm) {
      flushTable();
      if (!inList || listTag !== "ul") {
        flushList();
        out.push("<ul>");
        inList = true;
        listTag = "ul";
      }
      out.push(`<li>${inline(escMd(ulm[2]))}</li>`);
      continue;
    }

    const olm = line.match(/^\d+\.\s+(.+)$/);
    if (olm) {
      flushTable();
      if (!inList || listTag !== "ol") {
        flushList();
        out.push("<ol>");
        inList = true;
        listTag = "ol";
      }
      out.push(`<li>${inline(escMd(olm[1]))}</li>`);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    out.push(`<p>${inline(escMd(line))}</p>`);
  }

  flushList();
  flushTable();
  return out.join("\n");
}

export function loadDashboardDocsHtml(baseDir: string): string {
  let docsHtml = '<p style="color:#71717a;">Documentation not available. See <a href="https://github.com/trupix/tasksync" target="_blank">README.md</a> on GitHub.</p>';
  try {
    docsHtml = markdownToHtml(fs.readFileSync(path.join(baseDir, "../../README.md"), "utf8"));
  } catch {
    // README.md not found at runtime
  }
  return docsHtml;
}
