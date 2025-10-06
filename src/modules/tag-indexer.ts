import * as path from "path";
import ignore from "ignore";
import * as vscode from "vscode";
import {
  TagEntries,
  TagEntryLocation,
  TagIndex,
  TagLocation,
} from "../types/tag-models";
import { TagIndexer, TagIndexerState } from "../types/tag-contracts";

const DEFAULT_IGNORE_PATTERNS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.vscode/**",
];

interface TagIndexerDependencies {
  readonly store: {
    handleUpdateFile(input: {
      uri: vscode.Uri;
      entries: TagEntries;
    }): Promise<void>;
    handleRemoveFile(input: { uri: vscode.Uri }): Promise<void>;
    handleRenameFile(input: {
      oldUri: vscode.Uri;
      newUri: vscode.Uri;
    }): Promise<void>;
    handleReplaceAll(input: { index: TagIndex }): Promise<void>;
  };
  readonly parser: {
    readonly state: { tags: string[] };
    handleParseDocument(input: { content: string }): TagEntries;
  };
  readonly workspace: typeof vscode.workspace;
  readonly window: typeof vscode.window;
  readonly ignoreGlobs?: ReadonlyArray<string>;
}

interface InternalTagIndexerState extends TagIndexerState {
  ignoreMatcher?: IgnoreMatcher;
  gitIgnoreRules: IgnoreRule[];
}

export function createTagIndexer(deps: TagIndexerDependencies): TagIndexer {
  const initialIgnoreGlobs = Array.from(
    new Set([...(deps.ignoreGlobs ?? []), ...DEFAULT_IGNORE_PATTERNS])
  );

  const state: InternalTagIndexerState = {
    rebuildInProgress: false,
    ignoreGlobs: initialIgnoreGlobs,
    gitIgnoreRules: [],
    ignoreMatcher: buildIgnoreMatcher(initialIgnoreGlobs),
  };

  function init(): void {
    void refreshGitIgnoreRules();
  }

  function dispose(): void {}

  async function handleRebuild(input: {
    showNotification: boolean;
  }): Promise<void> {
    if (state.rebuildInProgress) {
      if (input.showNotification) {
        deps.window.showInformationMessage("Tagliner is already rebuilding.");
      }
      return;
    }

    state.rebuildInProgress = true;
    const tags = [...deps.parser.state.tags];

    try {
      await deps.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Tagliner: Rebuilding index…",
        },
        async (progress) => {
          if (tags.length === 0) {
            await deps.store.handleReplaceAll({ index: {} });
            return;
          }

          state.ignoreMatcher = buildIgnoreMatcher(state.ignoreGlobs);
          await refreshGitIgnoreRules();

          const aggregated = new Map<
            string,
            Map<string, Map<string, TagEntryLocation>>
          >();

          const excludeGlob = buildExcludeGlob(
            deps.workspace,
            state.ignoreGlobs
          );
          const files = await findWorkspaceFiles(deps.workspace, excludeGlob);
          const filtered = files.filter((uri) => shouldIndexUri(uri));

          if (filtered.length === 0) {
            await deps.store.handleReplaceAll({ index: {} });
            return;
          }

          const increment = 100 / filtered.length;

          for (const uri of filtered) {
            progress.report({
              increment,
              message: deps.workspace.asRelativePath(uri, false),
            });

            try {
              const document = await deps.workspace.openTextDocument(uri);
              const entries = deps.parser.handleParseDocument({
                content: document.getText(),
              });
              if (entries.size === 0) continue;
              mergeEntries(aggregated, entries, uri);
            } catch (error) {
              console.error(
                "Tagliner failed to parse file during rebuild",
                uri.toString(),
                error
              );
            }
          }

          await deps.store.handleReplaceAll({
            index: convertAggregatedToIndex(aggregated),
          });
        }
      );

      if (input.showNotification) {
        deps.window.showInformationMessage("Tagliner rebuild complete.");
      }
    } catch (error) {
      console.error("Tagliner rebuild failed", error);
      if (input.showNotification) {
        deps.window.showErrorMessage(
          "Tagliner rebuild failed. Check logs for details."
        );
      }
    } finally {
      state.rebuildInProgress = false;
    }
  }

  function handleUpdateIgnoreGlobs(input: { ignoreGlobs: string[] }): void {
    state.ignoreGlobs = Array.from(
      new Set([...DEFAULT_IGNORE_PATTERNS, ...input.ignoreGlobs])
    );
    state.ignoreMatcher = buildIgnoreMatcher(state.ignoreGlobs);
    void refreshGitIgnoreRules();
  }

  async function handleDidSaveDocument(
    document: vscode.TextDocument
  ): Promise<void> {
    await indexUri(document.uri, async () => document);
  }

  async function handleDidDeleteFiles(
    event: vscode.FileDeleteEvent
  ): Promise<void> {
    for (const file of event.files) {
      await deps.store.handleRemoveFile({ uri: file });
    }
  }

  async function handleDidRenameFiles(
    event: vscode.FileRenameEvent
  ): Promise<void> {
    for (const file of event.files) {
      await deps.store.handleRenameFile({
        oldUri: file.oldUri,
        newUri: file.newUri,
      });
      await indexUri(file.newUri);
    }
  }

  async function indexUri(
    uri: vscode.Uri,
    documentFactory?: () => Promise<vscode.TextDocument>
  ): Promise<void> {
    if (!shouldIndexUri(uri)) {
      await deps.store.handleRemoveFile({ uri });
      return;
    }

    if (deps.parser.state.tags.length === 0) {
      await deps.store.handleRemoveFile({ uri });
      return;
    }

    try {
      const document = documentFactory
        ? await documentFactory()
        : await deps.workspace.openTextDocument(uri);

      const entries = deps.parser.handleParseDocument({
        content: document.getText(),
      });

      if (entries.size === 0) {
        await deps.store.handleRemoveFile({ uri });
        return;
      }

      await deps.store.handleUpdateFile({ uri, entries });
    } catch (error) {
      console.error("Tagliner failed to index", uri.toString(), error);
    }
  }

  function shouldIndexUri(uri: vscode.Uri): boolean {
    if (!shouldProcessUri(deps.workspace, uri)) return false;
    if (isIgnoredByGlobs(uri)) return false;
    if (isIgnoredByGitIgnore(deps.workspace, state.gitIgnoreRules, uri)) return false;
    return true;
  }

  function isIgnoredByGlobs(uri: vscode.Uri): boolean {
    const matcher = state.ignoreMatcher;
    if (!matcher) return false;
    const folder = deps.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const relative = getNormalisedRelativePath(folder.uri.fsPath, uri.fsPath);
    if (!relative) return false;
    return matcher.ignores(relative);
  }

  async function refreshGitIgnoreRules(): Promise<void> {
    try {
      state.gitIgnoreRules = await createGitIgnoreRules(
        deps.workspace,
        state.ignoreGlobs
      );
    } catch (error) {
      console.error("Tagliner failed to refresh .gitignore rules", error);
      state.gitIgnoreRules = [];
    }
  }

  return {
    state,
    init,
    dispose,
    handleRebuild,
    handleUpdateIgnoreGlobs,
    handlers: {
      didSaveDocument: handleDidSaveDocument,
      didDeleteFiles: handleDidDeleteFiles,
      didRenameFiles: handleDidRenameFiles,
      rebuildWithNotification: () => handleRebuild({ showNotification: true }),
    },
  };
}

function shouldProcessDocument(
  workspace: typeof vscode.workspace,
  document: vscode.TextDocument
): boolean {
  if (document.isUntitled) return false;
  if (!shouldProcessUri(workspace, document.uri)) return false;
  return workspace.getWorkspaceFolder(document.uri) !== undefined;
}

function shouldProcessUri(
  workspace: typeof vscode.workspace,
  uri: vscode.Uri
): boolean {
  if (uri.scheme !== "file") return false;
  return workspace.getWorkspaceFolder(uri) !== undefined;
}

function buildExcludeGlob(
  workspace: typeof vscode.workspace,
  defaultPatterns: ReadonlyArray<string>
): string | undefined {
  const patterns = new Set(defaultPatterns);

  const filesExclude =
    workspace
      .getConfiguration("files")
      .get<Record<string, boolean>>("exclude") ?? {};
  const searchExclude =
    workspace
      .getConfiguration("search")
      .get<Record<string, boolean>>("exclude") ?? {};

  addEnabledPatterns(patterns, filesExclude);
  addEnabledPatterns(patterns, searchExclude);

  const entries = Array.from(patterns).filter(
    (pattern) => pattern && pattern.trim().length > 0
  );
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0];
  return `{${entries.join(",")}}`;
}

function addEnabledPatterns(
  target: Set<string>,
  patterns: Record<string, unknown>
): void {
  for (const [pattern, value] of Object.entries(patterns)) {
    if (value) target.add(pattern);
  }
}

async function findWorkspaceFiles(
  workspace: typeof vscode.workspace,
  excludeGlob?: string
): Promise<vscode.Uri[]> {
  if (excludeGlob && excludeGlob.length > 0) {
    return workspace.findFiles("**/*", excludeGlob);
  }
  return workspace.findFiles("**/*");
}

type IgnoreMatcher = ReturnType<typeof ignore>;

interface IgnoreRule {
  readonly basePath: string;
  readonly matcher: IgnoreMatcher;
}

async function createGitIgnoreRules(
  workspace: typeof vscode.workspace,
  ignorePatterns: readonly string[]
): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  const excludeGlob = buildExcludeGlob(workspace, ignorePatterns);
  let gitIgnoreUris: vscode.Uri[] = [];

  try {
    gitIgnoreUris = await workspace.findFiles("**/.gitignore", excludeGlob);
  } catch (error) {
    console.error("Tagliner failed to enumerate .gitignore files", error);
  }

  for (const uri of gitIgnoreUris) {
    try {
      const buffer = await workspace.fs.readFile(uri);
      const content = Buffer.from(buffer).toString("utf8");
      if (content.trim().length === 0) continue;
      const matcher = ignore().add(content);
      rules.push({ basePath: path.dirname(uri.fsPath), matcher });
    } catch (error) {
      console.error("Tagliner failed to read .gitignore", uri.toString(), error);
    }
  }

  return rules;
}

function isIgnoredByGitIgnore(
  workspace: typeof vscode.workspace,
  rules: ReadonlyArray<IgnoreRule>,
  uri: vscode.Uri
): boolean {
  const folder = workspace.getWorkspaceFolder(uri);
  if (!folder) return false;

  const filePath = uri.fsPath;

  for (const rule of rules) {
    if (!isWithinBasePath(rule.basePath, filePath)) continue;
    const relativePath = filePath.slice(
      ensureTrailingSeparator(rule.basePath).length
    );
    if (relativePath.length === 0) continue;
    const normalised = toPosixPath(relativePath);
    if (rule.matcher.ignores(normalised)) return true;
  }

  return false;
}

function isWithinBasePath(basePath: string, candidatePath: string): boolean {
  const prefix = ensureTrailingSeparator(basePath);
  return candidatePath.startsWith(prefix);
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function buildIgnoreMatcher(patterns: readonly string[]): IgnoreMatcher | undefined {
  const entries = patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map(toPosixPath);

  if (entries.length === 0) return undefined;
  return ignore().add(entries);
}

function getNormalisedRelativePath(
  basePath: string,
  targetPath: string
): string | undefined {
  const relative = path.relative(basePath, targetPath);
  if (!relative || relative.startsWith("..")) return undefined;
  return toPosixPath(relative);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function mergeEntries(
  aggregate: Map<string, Map<string, Map<string, TagEntryLocation>>>,
  entries: TagEntries,
  uri: vscode.Uri
): void {
  for (const [tag, values] of entries) {
    if (!aggregate.has(tag)) aggregate.set(tag, new Map());
    const perTag = aggregate.get(tag)!;
    for (const [value, locations] of values) {
      if (locations.length === 0) continue;
      if (!perTag.has(value)) perTag.set(value, new Map());
      const perValue = perTag.get(value)!;
      const fileKey = uri.toString();
      const best = locations.reduce(
        (prev, candidate) =>
          isLocationBefore(candidate, prev) ? candidate : prev,
        locations[0]
      );
      const existing = perValue.get(fileKey);
      if (!existing || isLocationBefore(best, existing)) {
        perValue.set(fileKey, best);
      }
    }
  }
}

function convertAggregatedToIndex(
  aggregate: Map<string, Map<string, Map<string, TagEntryLocation>>>
): TagIndex {
  const next: TagIndex = {};
  aggregate.forEach((valueMap, tag) => {
    const bucket: Record<string, TagLocation[]> = {};
    valueMap.forEach((fileMap, value) => {
      const locations: TagLocation[] = [];
      fileMap.forEach((location, uri) => {
        locations.push({
          uri,
          line: location.line,
          character: location.character,
        });
      });
      if (locations.length === 0) return;
      locations.sort((left, right) => {
        if (left.uri === right.uri) {
          if (left.line === right.line) return left.character - right.character;
          return left.line - right.line;
        }
        return left.uri.localeCompare(right.uri);
      });
      bucket[value] = locations;
    });
    if (Object.keys(bucket).length > 0) next[tag] = bucket;
  });
  return next;
}

function isLocationBefore(
  first: TagEntryLocation,
  second: TagEntryLocation
): boolean {
  if (first.line < second.line) return true;
  if (first.line > second.line) return false;
  return first.character < second.character;
}
