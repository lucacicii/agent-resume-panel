import React, { memo, useEffect, useRef, useState } from "react";

export interface ArtifactHtmlSandboxProps {
  code: string;
  isStreaming?: boolean;
  reloadKey?: number;
  minHeight?: number;
}

export const ArtifactHtmlSandbox = memo(function ArtifactHtmlSandbox({
  code,
  isStreaming = false,
  reloadKey = 0,
  minHeight = 300
}: ArtifactHtmlSandboxProps) {
  const [debouncedCode, setDebouncedCode] = useState(code);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setDebouncedCode(code);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedCode(code);
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [code, isStreaming]);

  // Ensure HTML string has a basic doctype/viewport wrapper if missing
  const srcDoc = React.useMemo(() => {
    const trimmed = debouncedCode.trim();
    if (trimmed.toLowerCase().includes("<html") || trimmed.toLowerCase().includes("<!doctype")) {
      return trimmed;
    }
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111;
      background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body {
        color: #eee;
        background: #121212;
      }
    }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
  }, [debouncedCode]);

  return (
    <div className="artifact-html-sandbox-wrap" style={{ minHeight }}>
      <iframe
        key={reloadKey}
        className="artifact-html-iframe"
        title="HTML Preview Sandbox"
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        loading="lazy"
      />
    </div>
  );
});
