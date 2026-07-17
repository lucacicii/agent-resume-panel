import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["css", css],
  ["go", go],
  ["java", java],
  ["javascript", javascript],
  ["js", javascript],
  ["json", json],
  ["markdown", markdown],
  ["md", markdown],
  ["python", python],
  ["py", python],
  ["rust", rust],
  ["sh", shell],
  ["shell", shell],
  ["sql", sql],
  ["typescript", typescript],
  ["ts", typescript],
  ["xml", xml],
  ["html", xml],
  ["yaml", yaml],
  ["yml", yaml]
];

for (const [name, mod] of languages) {
  hljs.registerLanguage(name, mod);
}

globalThis.hljs = hljs;