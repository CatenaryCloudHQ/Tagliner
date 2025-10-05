import { parseTagEntries, sanitiseTags } from "../helpers/tag-utils";
import { TagEntries } from "../types/tag-models";
import { TagParser, TagParserState } from "../types/tag-contracts";
export function createTagParser(): TagParser {
  const state: TagParserState = {
    tags: [],
  };

  function init(input: { tags: string[] }): void {
    state.tags = sanitiseTags(input.tags);
  }

  function dispose(): void {
    state.tags = [];
  }

  function handleUpdateTags(input: { tags: string[] }): void {
    state.tags = sanitiseTags(input.tags);
  }

  function handleParseDocument(input: { content: string }): TagEntries {
    return parseTagEntries(state.tags, input.content);
  }

  return {
    state,
    init,
    dispose,
    handleUpdateTags,
    handleParseDocument,
  };
}
