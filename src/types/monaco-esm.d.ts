declare module "monaco-editor/esm/vs/editor/editor.api" {
  const monaco: typeof import("monaco-editor");
  export = monaco;
}

declare module "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
