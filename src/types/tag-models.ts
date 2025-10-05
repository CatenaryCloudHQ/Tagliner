import * as vscode from 'vscode';

export interface TagEntryLocation {
  readonly line: number;
  readonly character: number;
}

export interface TagLocation {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
}

export type TagIndex = Record<string, Record<string, TagLocation[]>>;

export type TagEntries = Map<string, Map<string, TagEntryLocation[]>>;

export interface MessageTreeNode {
  readonly type: 'message';
  readonly message: string;
}

export interface ValueTreeNode {
  readonly type: 'value';
  readonly tag: string;
  readonly value: string;
  readonly showTagPrefix?: boolean;
}

export interface FileTreeNode {
  readonly type: 'file';
  readonly tag: string;
  readonly value: string;
  readonly uri: vscode.Uri;
  readonly displayPath: string;
  readonly line: number;
  readonly character: number;
}

export interface TagGroupTreeNode {
  readonly type: 'tag';
  readonly tag: string;
}

export type TagTreeNode = MessageTreeNode | TagGroupTreeNode | ValueTreeNode | FileTreeNode;
