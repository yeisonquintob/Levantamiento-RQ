import { readdirSync, readFileSync } from "node:fs";

const DOCUMENT_DIRECTORY = "apps/web/src/app/workspace/documents/[documentId]";
const PRESENTER_MODULES_DIRECTORY = `${DOCUMENT_DIRECTORY}/document-section-presenter`;

export function readDocumentSectionPresenterSource(): string {
  const modules = readdirSync(PRESENTER_MODULES_DIRECTORY)
    .filter((file) => /\.tsx?$/u.test(file))
    .sort()
    .map((file) =>
      readFileSync(`${PRESENTER_MODULES_DIRECTORY}/${file}`, "utf8"),
    );
  return [
    readFileSync(
      `${DOCUMENT_DIRECTORY}/document-section-presenter.tsx`,
      "utf8",
    ),
    ...modules,
  ].join("\n");
}
