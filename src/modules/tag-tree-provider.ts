import * as path from 'path';
import * as vscode from 'vscode';
import { TagTreeProvider, TagTreeProviderState } from '../types/tag-contracts';
import {
  FileTreeNode,
  MessageTreeNode,
  TagGroupTreeNode,
  TagLocation,
  TagTreeNode,
  ValueTreeNode,
} from '../types/tag-models';

interface TagTreeProviderDependencies {
  readonly store: {
    readonly onDidChange: vscode.Event<void>;
    getTagData(tag: string): Map<string, TagLocation[]>;
  };
  readonly workspace: {
    asRelativePath(uri: vscode.Uri, includeWorkspaceFolder?: boolean): string;
    getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined;
  };
}

export function createTagTreeProvider(deps: TagTreeProviderDependencies): TagTreeProvider {
  const state: TagTreeProviderState & { storeSubscription?: vscode.Disposable } = {
    availableTags: [],
    filterTag: undefined,
    storeSubscription: undefined,
  };

  const changeEmitter = new vscode.EventEmitter<TagTreeNode | undefined>();

  const provider: vscode.TreeDataProvider<TagTreeNode> = {
    onDidChangeTreeData: changeEmitter.event,
    getTreeItem: (element) => getTreeItem(state, deps, element),
    getChildren: (element) => getChildren(state, deps, element),
  };

  function init(input: { availableTags: string[]; filterTag?: string }): void {
    state.availableTags = [...input.availableTags];
    state.filterTag = input.filterTag;
    state.storeSubscription = deps.store.onDidChange(() => changeEmitter.fire(undefined));
    changeEmitter.fire(undefined);
  }

  function dispose(): void {
    changeEmitter.dispose();
    state.storeSubscription?.dispose();
    state.storeSubscription = undefined;
  }

  function handleSetAvailableTags(input: { tags: string[] }): void {
    state.availableTags = [...input.tags];
    changeEmitter.fire(undefined);
  }

  function handleSetFilter(input: { filterTag?: string }): void {
    state.filterTag = input.filterTag;
    changeEmitter.fire(undefined);
  }

  function handleRefresh(): void {
    changeEmitter.fire(undefined);
  }

  return {
    state,
    provider,
    init,
    dispose,
    handleSetAvailableTags,
    handleSetFilter,
    handleRefresh,
  };
}

function getTreeItem(state: TagTreeProviderState, deps: TagTreeProviderDependencies, element: TagTreeNode): vscode.TreeItem {
  if (element.type === 'message') return createMessageItem(element);
  if (element.type === 'tag') return createTagItem(element);
  if (element.type === 'value') {
    const files = deps.store.getTagData(element.tag).get(element.value) ?? [];
    return createValueItem(element, files);
  }
  return createFileItem(element);
}

function getChildren(state: TagTreeProviderState, deps: TagTreeProviderDependencies, element?: TagTreeNode): TagTreeNode[] {
  if (!element) return getRootChildren(state, deps);
  if (element.type === 'tag') return buildValueNodes(element.tag, state, deps);
  if (element.type === 'value') return getFileNodes(deps, element);
  return [];
}

function getRootChildren(state: TagTreeProviderState, deps: TagTreeProviderDependencies): TagTreeNode[] {
  if (state.availableTags.length === 0) return [createMessageNode('No tags configured')];

  if (state.filterTag && !state.availableTags.includes(state.filterTag)) {
    return [createMessageNode('Select a valid tag')];
  }

  if (state.filterTag) {
    const nodes = buildValueNodes(state.filterTag, state, deps);
    if (nodes.length === 0) return [createMessageNode(`No entries for ${state.filterTag}`)];
    return nodes;
  }

  const groups: TagGroupTreeNode[] = [];
  for (const tag of state.availableTags) {
    if (deps.store.getTagData(tag).size > 0) groups.push({ type: 'tag', tag });
  }

  if (groups.length === 0) return [createMessageNode('No tag entries found')];

  return groups.sort((left, right) => left.tag.localeCompare(right.tag));
}

function getFileNodes(deps: TagTreeProviderDependencies, element: ValueTreeNode): TagTreeNode[] {
  const files = deps.store.getTagData(element.tag).get(element.value) ?? [];
  return files
    .map<FileTreeNode>((entry) => {
      const uri = vscode.Uri.parse(entry.uri);
      const relative = resolveDisplayPath(deps.workspace, uri);
      const display = `${relative}:${entry.line + 1}:${entry.character + 1}`;
      return {
        type: 'file',
        tag: element.tag,
        value: element.value,
        uri,
        displayPath: display,
        line: entry.line,
        character: entry.character,
      };
    })
    .sort((left, right) => left.displayPath.localeCompare(right.displayPath));
}

function createMessageItem(element: MessageTreeNode): vscode.TreeItem {
  const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('info');
  item.contextValue = 'message';
  return item;
}

function createTagItem(element: TagGroupTreeNode): vscode.TreeItem {
  const item = new vscode.TreeItem(element.tag, vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = new vscode.ThemeIcon('list-selection');
  item.contextValue = 'tag-group';
  return item;
}

function createValueItem(element: ValueTreeNode, files: readonly TagLocation[]): vscode.TreeItem {
  const prefix = element.showTagPrefix ? `${element.tag}: ` : '';
  const label = `${prefix}${element.value} (${files.length})`;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = new vscode.ThemeIcon('tag');
  item.tooltip = element.value;
  item.contextValue = 'value';
  return item;
}

function createFileItem(element: FileTreeNode): vscode.TreeItem {
  const item = new vscode.TreeItem(element.displayPath, vscode.TreeItemCollapsibleState.None);
  item.label = { label: element.displayPath };
  item.id = `${element.tag}:${element.value}:${element.uri.toString()}:${element.line}:${element.character}`;
  item.command = {
    command: 'tagliner.openLocation',
    title: 'Open File',
    arguments: [
      {
        uri: element.uri,
        line: element.line,
        character: element.character,
      },
    ],
  };
  item.iconPath = vscode.ThemeIcon.File;
  item.tooltip = element.displayPath;
  item.contextValue = 'file';
  return item;
}

function createMessageNode(message: string): MessageTreeNode {
  return { type: 'message', message };
}

function normalisePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

function resolveDisplayPath(workspace: TagTreeProviderDependencies['workspace'], uri: vscode.Uri): string {
  const workspaceFolder = workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    const relativeToFolder = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    if (relativeToFolder) return normalisePath(relativeToFolder);
  }

  const fallback = workspace.asRelativePath(uri, false);
  if (fallback) return normalisePath(fallback);

  return normalisePath(uri.fsPath);
}

function buildValueNodes(tag: string, state: TagTreeProviderState, deps: TagTreeProviderDependencies): ValueTreeNode[] {
  const data = deps.store.getTagData(tag);
  if (data.size === 0) return [];

  const showTagPrefix = state.filterTag === undefined;

  return Array.from(data.keys())
    .sort((a, b) => a.localeCompare(b))
    .map<ValueTreeNode>((value) => ({ type: 'value', tag, value, showTagPrefix }));
}
