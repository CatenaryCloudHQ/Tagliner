import * as vscode from 'vscode';
import { cloneIndex, normaliseIndex, removeFileEntries, renameFileEntries, upsertEntries } from '../helpers/tag-utils';
import { TagEntries, TagIndex, TagLocation } from '../types/tag-models';
import { TagIndexStore, TagIndexStoreState } from '../types/tag-contracts';

const STORAGE_KEY = 'tagliner.tagIndex';
const INDEX_SCHEMA_VERSION = 2;

interface TagIndexStoreDependencies {
  readonly memento: vscode.Memento;
}

export function createTagIndexStore(deps: TagIndexStoreDependencies): TagIndexStore {
  const state: TagIndexStoreState = {
    index: {},
  };

  const changeEmitter = new vscode.EventEmitter<void>();

  async function init(): Promise<void> {
    state.index = loadStoredIndex(deps.memento.get(STORAGE_KEY));
  }

  function dispose(): void {
    changeEmitter.dispose();
  }

  function getTagData(tag: string): Map<string, TagLocation[]> {
    const bucket = state.index[tag];
    if (!bucket) return new Map();
    return new Map(
      Object.entries(bucket).map(([value, locations]) => [value, locations.map((location) => ({ ...location }))]),
    );
  }

  async function handleUpdateFile(input: { uri: vscode.Uri; entries: TagEntries }): Promise<void> {
    const fileKey = input.uri.toString();
    const removal = removeFileEntries(state.index, fileKey);
    const upsert = upsertEntries(removal.next, fileKey, input.entries);

    if (!removal.changed && !upsert.changed) return;

    state.index = upsert.next;
    await persist(state.index);
    changeEmitter.fire();
  }

  async function handleRemoveFile(input: { uri: vscode.Uri }): Promise<void> {
    const fileKey = input.uri.toString();
    const removal = removeFileEntries(state.index, fileKey);
    if (!removal.changed) return;

    state.index = removal.next;
    await persist(state.index);
    changeEmitter.fire();
  }

  async function handleRenameFile(input: { oldUri: vscode.Uri; newUri: vscode.Uri }): Promise<void> {
    const oldKey = input.oldUri.toString();
    const newKey = input.newUri.toString();

    const rename = renameFileEntries(state.index, oldKey, newKey);
    if (!rename.changed) return;

    state.index = rename.next;
    await persist(state.index);
    changeEmitter.fire();
  }

  async function handleReplaceAll(input: { index: TagIndex }): Promise<void> {
    state.index = normaliseIndex(input.index);
    await persist(state.index);
    changeEmitter.fire();
  }

  async function persist(next: TagIndex): Promise<void> {
    await deps.memento.update(STORAGE_KEY, {
      version: INDEX_SCHEMA_VERSION,
      index: cloneIndex(next),
    });
  }

  return {
    state,
    onDidChange: changeEmitter.event,
    init,
    dispose,
    getTagData,
    handleUpdateFile,
    handleRemoveFile,
    handleRenameFile,
    handleReplaceAll,
  };
}

function loadStoredIndex(raw: unknown): TagIndex {
  if (!raw || typeof raw !== 'object') return {};
  const payload = raw as { version?: unknown; index?: unknown };
  if (payload.version !== INDEX_SCHEMA_VERSION) return {};
  return normaliseIndex(payload.index as TagIndex | undefined);
}
