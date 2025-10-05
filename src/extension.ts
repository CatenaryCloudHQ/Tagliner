import * as vscode from 'vscode';
import { createTagConfigurationController } from './modules/tag-configuration';
import { createTagIndexStore } from './modules/tag-index-store';
import { createTagIndexer } from './modules/tag-indexer';
import { createTagParser } from './modules/tag-parser';
import { createTagTreeProvider } from './modules/tag-tree-provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = createTagIndexStore({ memento: context.globalState });
  const parser = createTagParser();
  const treeProvider = createTagTreeProvider({
    store: {
      onDidChange: store.onDidChange,
      getTagData: store.getTagData,
    },
    workspace: {
      asRelativePath: (uri: vscode.Uri, includeWorkspaceFolder?: boolean) =>
        vscode.workspace.asRelativePath(uri, includeWorkspaceFolder),
      getWorkspaceFolder: (uri: vscode.Uri) => vscode.workspace.getWorkspaceFolder(uri),
    },
  });

  const initialIgnoreGlobs = (vscode.workspace.getConfiguration('tagliner').get<string[]>('ignoreGlobs', []) ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  const indexer = createTagIndexer({
    store: {
      handleUpdateFile: store.handleUpdateFile,
      handleRemoveFile: store.handleRemoveFile,
      handleRenameFile: store.handleRenameFile,
      handleReplaceAll: store.handleReplaceAll,
    },
    parser,
    workspace: vscode.workspace,
    window: vscode.window,
    ignoreGlobs: initialIgnoreGlobs,
  });

  const configuration = createTagConfigurationController({
    workspace: vscode.workspace,
    workspaceState: context.workspaceState,
    window: vscode.window,
    parser,
    treeProvider,
    onIgnoreGlobsChanged: (ignoreGlobs) => indexer.handleUpdateIgnoreGlobs({ ignoreGlobs }),
  });

  context.subscriptions.push(store, treeProvider, indexer, { dispose: configuration.dispose });
  context.subscriptions.push(vscode.window.registerTreeDataProvider('tagliner.tagView', treeProvider.provider));

  await store.init();
  await configuration.init();
  indexer.init();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(indexer.handlers.didSaveDocument),
    vscode.workspace.onDidDeleteFiles(indexer.handlers.didDeleteFiles),
    vscode.workspace.onDidRenameFiles(indexer.handlers.didRenameFiles),
    vscode.workspace.onDidChangeConfiguration(configuration.handleConfigurationChanged),
    vscode.commands.registerCommand('tagliner.rebuild', indexer.handlers.rebuildWithNotification),
    vscode.commands.registerCommand('tagliner.selectTagFilter', configuration.handleSelectFilter),
    vscode.commands.registerCommand('tagliner.openLocation', async (payload?: { uri: vscode.Uri; line: number; character: number }) => {
      if (!payload) return;
      const { uri, line, character } = payload;
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(
            new vscode.Position(line, character),
            new vscode.Position(line, character),
          ),
        });
        editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open ${uri.fsPath}`);
        console.error('Tagliner failed to open location', uri.toString(), error);
      }
    }),
  );

  console.log('Tagliner extension activated');
}

export function deactivate(): void {}
