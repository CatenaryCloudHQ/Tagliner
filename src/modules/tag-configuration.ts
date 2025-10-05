import * as vscode from "vscode";
import { ensureValidFilter, sanitiseTags } from "../helpers/tag-utils";
import { TagParser, TagTreeProvider } from "../types/tag-contracts";
//METATAG: state12bug
const FILTER_STATE_KEY = "tagliner.selectedTag";

interface TagConfigurationDependencies {
  readonly workspace: typeof vscode.workspace;
  readonly workspaceState: vscode.Memento;
  readonly window: typeof vscode.window;
  readonly parser: TagParser;
  readonly treeProvider: TagTreeProvider;
  readonly onIgnoreGlobsChanged: (globs: string[]) => void;
}

interface TagConfigurationState {
  filterTag?: string;
  ignoreGlobs: string[];
}

export interface TagConfigurationController {
  readonly state: TagConfigurationState;
  init(): Promise<void>;
  dispose(): void;
  handleConfigurationChanged(
    event: vscode.ConfigurationChangeEvent
  ): Promise<void>;
  handleSelectFilter(): Promise<void>;
}

export function createTagConfigurationController(
  deps: TagConfigurationDependencies
): TagConfigurationController {
  const state: TagConfigurationState = {
    filterTag: undefined,
    ignoreGlobs: [],
  };

  async function init(): Promise<void> {
    const tags = readConfiguredTags(deps.workspace);
    deps.parser.init({ tags });

    const storedFilter =
      deps.workspaceState.get<string | null>(FILTER_STATE_KEY, null) ??
      undefined;
    const filter = ensureValidFilter(deps.parser.state.tags, storedFilter);

    deps.treeProvider.init({
      availableTags: deps.parser.state.tags,
      filterTag: filter,
    });
    deps.treeProvider.handleSetAvailableTags({ tags: deps.parser.state.tags });
    deps.treeProvider.handleSetFilter({ filterTag: filter });

    state.filterTag = filter;
    await deps.workspaceState.update(FILTER_STATE_KEY, filter ?? null);

    state.ignoreGlobs = readIgnoreGlobs(deps.workspace);
    deps.onIgnoreGlobsChanged(state.ignoreGlobs);
  }

  function dispose(): void {}

  async function handleConfigurationChanged(
    event: vscode.ConfigurationChangeEvent
  ): Promise<void> {
    let shouldNotifyTags = false;

    if (event.affectsConfiguration("tagliner.tags")) {
      const tags = readConfiguredTags(deps.workspace);
      deps.parser.handleUpdateTags({ tags });
      deps.treeProvider.handleSetAvailableTags({
        tags: deps.parser.state.tags,
      });

      const nextFilter = ensureValidFilter(
        deps.parser.state.tags,
        deps.treeProvider.state.filterTag
      );
      deps.treeProvider.handleSetFilter({ filterTag: nextFilter });
      state.filterTag = nextFilter;
      await deps.workspaceState.update(FILTER_STATE_KEY, nextFilter ?? null);
      shouldNotifyTags = deps.parser.state.tags.length > 0;
    }

    if (event.affectsConfiguration("tagliner.ignoreGlobs")) {
      state.ignoreGlobs = readIgnoreGlobs(deps.workspace);
      deps.onIgnoreGlobsChanged(state.ignoreGlobs);
    }

    if (shouldNotifyTags) {
      deps.window.showInformationMessage(
        'Tag list updated. Run "Tagliner: Rebuild Tag Index" to refresh results.'
      );
    }
  }

  async function handleSelectFilter(): Promise<void> {
    if (deps.parser.state.tags.length === 0) {
      deps.window.showInformationMessage(
        "No tags configured. Update Tagliner settings to begin indexing."
      );
      return;
    }

    type TagQuickPickItem = vscode.QuickPickItem & { tag?: string };

    const current = deps.treeProvider.state.filterTag;
    const items: TagQuickPickItem[] = [
      {
        label: "Show All Tags",
        description: "Clear the current tag filter",
        alwaysShow: true,
        tag: undefined,
        picked: current === undefined,
      },
      ...deps.parser.state.tags.map<TagQuickPickItem>((tag) => ({
        label: tag,
        picked: tag === current,
        tag,
      })),
    ];

    const selection = await deps.window.showQuickPick(items, {
      placeHolder: current
        ? `Current filter: ${current}`
        : "Select the tag you want to explore",
    });

    if (!selection) return;

    const chosen = selection as TagQuickPickItem;
    const nextTag = chosen.tag;

    if ((nextTag ?? undefined) === current) {
      deps.treeProvider.handleSetFilter({ filterTag: undefined });
      state.filterTag = undefined;
      await deps.workspaceState.update(FILTER_STATE_KEY, null);
      return;
    }

    deps.treeProvider.handleSetFilter({ filterTag: nextTag });
    state.filterTag = nextTag;
    await deps.workspaceState.update(FILTER_STATE_KEY, nextTag ?? null);
  }

  return {
    state,
    init,
    dispose,
    handleConfigurationChanged,
    handleSelectFilter,
  };
}

function readConfiguredTags(workspace: typeof vscode.workspace): string[] {
  const raw = workspace.getConfiguration("tagliner").get<string[]>("tags", []);
  return sanitiseTags(raw);
}

function readIgnoreGlobs(workspace: typeof vscode.workspace): string[] {
  const raw = workspace
    .getConfiguration("tagliner")
    .get<string[]>("ignoreGlobs", []);
  return raw
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}
