"use client";
import Editor, { OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { get } from "@/lib/api";

type Span = { file: string; lines: number[] };
type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

const cache: Record<string, string> = {};

function registerCobol(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === "cobol")) return;
  monaco.languages.register({ id: "cobol" });
  monaco.languages.setMonarchTokensProvider("cobol", {
    ignoreCase: true,
    keywords: ["PERFORM", "UNTIL", "IF", "ELSE", "END-IF", "MOVE", "TO", "ADD", "COMPUTE", "READ", "WRITE", "REWRITE",
      "INVALID", "KEY", "NOT", "END-READ", "END-PERFORM", "EVALUATE", "WHEN", "END-EVALUATE", "CONTINUE", "EXIT",
      "OPEN", "CLOSE", "INPUT", "OUTPUT", "I-O", "DISPLAY", "CALL", "USING", "GOBACK", "STRING", "DELIMITED", "BY",
      "SIZE", "INTO", "END-STRING", "INITIALIZE", "FROM", "PIC", "VALUE", "COPY", "SELECT", "ASSIGN", "OR", "AND",
      "END-REWRITE", "SPACES", "FUNCTION", "RETURN-CODE", "OF", "IS"],
    tokenizer: {
      root: [
        [/^.{6}[*\/].*$/, "comment"],
        [/'[^']*'/, "string"],
        [/"[^"]*"/, "string"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/[A-Za-z][\w-]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      ],
    },
  });
  // GitHub light syntax colors.
  monaco.editor.defineTheme("ledger-paper", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6e7781", fontStyle: "italic" },
      { token: "keyword", foreground: "cf222e" },
      { token: "string", foreground: "0a3069" },
      { token: "number", foreground: "0550ae" },
      { token: "identifier", foreground: "1f2328" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editorLineNumber.foreground": "#8c959f",
      "editorLineNumber.activeForeground": "#1f2328",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editorGutter.background": "#ffffff",
      "editorRuler.foreground": "#eeece8",
    },
  });
}

export default function SourceView({
  file, spans, active, executed, height = "100%", language = "cobol", text,
}: {
  file: string;
  spans: Span[];
  active?: Span | null;
  executed?: number[];
  height?: string;
  language?: string;
  text?: string;
}) {
  const [src, setSrc] = useState<string | null>(text ?? cache[file] ?? null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decoRef = useRef<string[]>([]);

  useEffect(() => {
    if (text !== undefined) { setSrc(text); return; }
    if (cache[file]) { setSrc(cache[file]); return; }
    get<{ lines: string[] }>(`/api/source/${file}`).then((d) => {
      cache[file] = d.lines.map((l) => l.replace(/\s+$/, "")).join("\n");
      setSrc(cache[file]);
    });
  }, [file, text]);

  function decorate() {
    const ed = editorRef.current, monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const n = model.getLineCount();
    const decos: Parameters<MonacoEditor["deltaDecorations"]>[1] = [];
    for (const s of spans.filter((s) => s.file === file && s.lines.length === 2)) {
      decos.push({ range: new monaco.Range(s.lines[0], 1, s.lines[1], 1), options: { isWholeLine: true, className: "ledger-cited", linesDecorationsClassName: "ledger-cited-gutter" } });
    }
    for (const ln of executed ?? []) {
      if (ln <= n) decos.push({ range: new monaco.Range(ln, 1, ln, 1), options: { isWholeLine: false, linesDecorationsClassName: "ledger-exec-gutter" } });
    }
    if (active && active.file === file && active.lines.length === 2) {
      decos.push({ range: new monaco.Range(active.lines[0], 1, active.lines[1], 1), options: { isWholeLine: true, className: "ledger-active", linesDecorationsClassName: "ledger-active-gutter" } });
      ed.revealLinesInCenter(active.lines[0], active.lines[1]);
    } else {
      const first = spans.find((s) => s.file === file && s.lines.length === 2);
      if (first) ed.revealLinesInCenter(first.lines[0], first.lines[1]);
    }
    decoRef.current = ed.deltaDecorations(decoRef.current, decos);
  }

  useEffect(decorate, [spans, active, executed, src, file]); // eslint-disable-line react-hooks/exhaustive-deps

  if (src === null) return <div className="p-6 text-ink-soft text-[14px]">Loading {file}…</div>;
  return (
    <Editor
      height={height}
      language={language}
      value={src}
      theme={language === "cobol" ? "ledger-paper" : "vs"}
      beforeMount={registerCobol}
      onMount={(ed, monaco) => { editorRef.current = ed; monacoRef.current = monaco; decorate(); }}
      options={{
        readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontFamily: "var(--font-plex-mono), monospace",
        fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false, renderLineHighlight: "none", wordWrap: "off",
        lineDecorationsWidth: 16, glyphMargin: false, folding: false, rulers: language === "cobol" ? [6, 7, 72] : [],
        overviewRulerLanes: 0, scrollbar: { verticalScrollbarSize: 10 },
      }}
    />
  );
}
