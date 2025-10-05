import * as vscode from 'vscode';
import { TagEntries, TagIndex, TagLocation, TagTreeNode } from './tag-models';

export interface TagParserState {
  tags: string[];
}

export interface TagParser {
  readonly state: TagParserState;
  init(input: { tags: string[] }): void;
  dispose(): void;
  handleUpdateTags(input: { tags: string[] }): void;
  handleParseDocument(input: { content: string }): TagEntries;
}

export interface TagIndexStoreState {
  index: TagIndex;
}

export interface TagIndexStore {
  readonly state: TagIndexStoreState;
  readonly onDidChange: vscode.Event<void>;
  init(): Promise<void>;
  dispose(): void;
  getTagData(tag: string): Map<string, TagLocation[]>;
  handleUpdateFile(input: { uri: vscode.Uri; entries: TagEntries }): Promise<void>;
  handleRemoveFile(input: { uri: vscode.Uri }): Promise<void>;
  handleRenameFile(input: { oldUri: vscode.Uri; newUri: vscode.Uri }): Promise<void>;
  handleReplaceAll(input: { index: TagIndex }): Promise<void>;
}

export interface TagTreeProviderState {
  availableTags: string[];
  filterTag?: string;
}

export interface TagTreeProvider {
  readonly state: TagTreeProviderState;
  readonly provider: vscode.TreeDataProvider<TagTreeNode>;
  init(input: { availableTags: string[]; filterTag?: string }): void;
  dispose(): void;
  handleSetAvailableTags(input: { tags: string[] }): void;
  handleSetFilter(input: { filterTag?: string }): void;
  handleRefresh(): void;
}

export interface TagIndexerState {
  rebuildInProgress: boolean;
  ignoreGlobs: string[];
}

export interface TagIndexer {
  readonly state: TagIndexerState;
  init(): void;
  dispose(): void;
  handleRebuild(input: { showNotification: boolean }): Promise<void>;
  handleUpdateIgnoreGlobs(input: { ignoreGlobs: string[] }): void;
  handlers: {
    readonly didSaveDocument: (document: vscode.TextDocument) => Promise<void>;
    readonly didDeleteFiles: (event: vscode.FileDeleteEvent) => Promise<void>;
    readonly didRenameFiles: (event: vscode.FileRenameEvent) => Promise<void>;
    readonly rebuildWithNotification: () => Promise<void>;
  };
}
