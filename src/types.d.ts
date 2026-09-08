/**
 * mammoth ships types for its Node entry point only; the browser bundle has none.
 * Only the one function this app uses is declared.
 */
declare module "mammoth/mammoth.browser.js" {
  export function extractRawText(
    input: { arrayBuffer: ArrayBuffer },
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
}
