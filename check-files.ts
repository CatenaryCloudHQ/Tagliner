import path from "path";
import ts from "typescript";

interface SerializedDiagnostic {
  readonly code: number;
  readonly category: string;
  readonly message: string;
  readonly file?: string;
  readonly start?: number;
  readonly length?: number;
  readonly related: ReadonlyArray<SerializedRelatedInfo>;
}

interface SerializedRelatedInfo {
  readonly message: string;
  readonly file?: string;
  readonly start?: number;
  readonly length?: number;
}

function main(): number {
  const targets = process.argv.slice(2).map((argument) => path.resolve(argument));
  if (targets.length === 0) {
    console.error("Usage: ts-node check-files.ts <file> [additional files...]");
    return 1;
  }

  const configPath = ts.findConfigFile("./", ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    console.error("Cannot find tsconfig.json");
    return 1;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    console.error("Failed to read tsconfig.json");
    return 1;
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
  });

  const allDiagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];

  const targetSet = new Set(targets);
  const relevant = allDiagnostics.filter((diagnostic) => matchesAnyTarget(diagnostic, targetSet));
  const payload = relevant.map((diagnostic) => serializeDiagnostic(diagnostic));

  console.log(JSON.stringify(payload, null, 2));
  return payload.length > 0 ? 1 : 0;
}

function matchesAnyTarget(diagnostic: ts.Diagnostic, targets: Set<string>): boolean {
  if (diagnostic.file && targets.has(path.resolve(diagnostic.file.fileName))) return true;
  const related = diagnostic.relatedInformation ?? [];
  for (const info of related) {
    if (info.file && targets.has(path.resolve(info.file.fileName))) return true;
  }
  return false;
}

function serializeDiagnostic(diagnostic: ts.Diagnostic): SerializedDiagnostic {
  return {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category],
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    file: diagnostic.file ? path.relative(process.cwd(), diagnostic.file.fileName) : undefined,
    start: diagnostic.start,
    length: diagnostic.length,
    related: serializeRelatedInformation(diagnostic.relatedInformation ?? []),
  };
}

function serializeRelatedInformation(
  related: ReadonlyArray<ts.DiagnosticRelatedInformation>,
): ReadonlyArray<SerializedRelatedInfo> {
  return related.map((info) => ({
    message: ts.flattenDiagnosticMessageText(info.messageText, "\n"),
    file: info.file ? path.relative(process.cwd(), info.file.fileName) : undefined,
    start: info.start,
    length: info.length,
  }));
}

process.exit(main());
