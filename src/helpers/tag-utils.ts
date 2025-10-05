import { TagEntries, TagEntryLocation, TagIndex, TagLocation } from '../types/tag-models';

export function sanitiseTags(input: string[]): string[] {
  const trimmed = input.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  return Array.from(new Set(trimmed));
}

export function ensureValidFilter(tags: readonly string[], candidate: string | undefined): string | undefined {
  if (candidate && tags.includes(candidate)) return candidate;
  return tags.length > 0 ? tags[0] : undefined;
}

export function parseTagEntries(tags: readonly string[], content: string): TagEntries {
  const results: TagEntries = new Map();
  if (!content || tags.length === 0) return results;

  const lines = content.split(/\r?\n/);
  tags.forEach((tag) => {
    const perValue = new Map<string, TagEntryLocation[]>();
    lines.forEach((lineText, lineNumber) => {
      const pattern = new RegExp(`\\b${escapeRegExp(tag)}\\s*:\\s*([^\\n\\r,]+)`, 'gi');
      for (const match of lineText.matchAll(pattern)) {
        const rawValue = match[1]?.trim() ?? '';
        if (!rawValue) continue;
        const cleaned = rawValue.replace(/[\s,.;:]+$/, '').trim();
        if (!cleaned) continue;
        const location: TagEntryLocation = {
          line: lineNumber,
          character: match.index ?? 0,
        };
        const bucket = perValue.get(cleaned) ?? [];
        if (!bucket.some((existing) => existing.line === location.line && existing.character === location.character)) {
          bucket.push(location);
        }
        perValue.set(cleaned, bucket);
      }
    });

    if (perValue.size > 0) {
      for (const locations of perValue.values()) {
        locations.sort((a, b) => (a.line === b.line ? a.character - b.character : a.line - b.line));
      }
      results.set(tag, perValue);
    }
  });

  return results;
}

export function normaliseIndex(candidate: TagIndex | undefined): TagIndex {
  if (!candidate) return {};
  const next: TagIndex = {};

  for (const [tag, values] of Object.entries(candidate)) {
    const filtered: Record<string, TagLocation[]> = {};
    for (const [value, locations] of Object.entries(values)) {
      const sanitized = locations.map((location) => ({
        uri: location.uri,
        line: typeof location.line === 'number' ? location.line : 0,
        character: typeof location.character === 'number' ? location.character : 0,
      }));
      const unique = dedupeLocations(sanitized);
      if (unique.length === 0) continue;
      filtered[value] = unique;
    }
    if (Object.keys(filtered).length === 0) continue;
    next[tag] = filtered;
  }

  return next;
}

export function cloneIndex(source: TagIndex): TagIndex {
  const clone: TagIndex = {};
  for (const [tag, values] of Object.entries(source)) {
    const nextValues: Record<string, TagLocation[]> = {};
    for (const [value, locations] of Object.entries(values)) {
      nextValues[value] = locations.map((location) => ({ ...location }));
    }
    clone[tag] = nextValues;
  }
  return clone;
}

export function removeFileEntries(index: TagIndex, fileKey: string): { next: TagIndex; changed: boolean } {
  let changed = false;
  const next = cloneIndex(index);

  for (const [tag, values] of Object.entries(next)) {
    let tagChanged = false;
    for (const [value, locations] of Object.entries(values)) {
      const filtered = locations.filter((location) => location.uri !== fileKey);
      if (filtered.length === locations.length) continue;

      changed = true;
      tagChanged = true;
      if (filtered.length === 0) delete values[value];
      else values[value] = filtered;
    }

    if (tagChanged && Object.keys(values).length === 0) delete next[tag];
  }

  return { next, changed };
}

export function upsertEntries(index: TagIndex, fileKey: string, entries: TagEntries): { next: TagIndex; changed: boolean } {
  let changed = false;
  const result = cloneIndex(index);

  for (const [tag, values] of entries) {
    if (!result[tag]) result[tag] = {};
    const bucket = result[tag]!;

    for (const [value, locations] of values) {
      if (locations.length === 0) continue;
      const best = selectBestLocation(locations);
      const location: TagLocation = { uri: fileKey, line: best.line, character: best.character };

      const existing = bucket[value] ?? [];
      const withoutFile = existing.filter((entry) => entry.uri !== fileKey);
      if (withoutFile.length !== existing.length) changed = true;

      if (!withoutFile.some((entry) => entry.uri === location.uri && entry.line === location.line && entry.character === location.character)) {
        withoutFile.push(location);
        changed = true;
      }

      bucket[value] = dedupeLocations(withoutFile);
    }

    if (Object.keys(bucket).length === 0) delete result[tag];
  }

  return { next: normaliseIndex(result), changed };
}

export function renameFileEntries(index: TagIndex, oldKey: string, newKey: string): { next: TagIndex; changed: boolean } {
  if (oldKey === newKey) return { next: index, changed: false };

  const clone = cloneIndex(index);
  let changed = false;

  for (const values of Object.values(clone)) {
      for (const [value, locations] of Object.entries(values)) {
        let updatedLocations = locations;
        for (let i = 0; i < updatedLocations.length; i += 1) {
          if (updatedLocations[i].uri !== oldKey) continue;
          updatedLocations = [...updatedLocations];
          updatedLocations[i] = { ...updatedLocations[i], uri: newKey };
          changed = true;
      }
      values[value] = dedupeLocations(updatedLocations);
    }
  }

  return { next: normaliseIndex(clone), changed };
}

function dedupeLocations(locations: TagLocation[]): TagLocation[] {
  const seen = new Set<string>();
  const unique: TagLocation[] = [];

  for (const location of locations) {
    const key = `${location.uri}:${location.line}:${location.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
  }

  return unique.sort((left, right) => {
    if (left.uri === right.uri) {
      if (left.line === right.line) return left.character - right.character;
      return left.line - right.line;
    }
    return left.uri.localeCompare(right.uri);
  });
}

function selectBestLocation(locations: TagEntryLocation[]): TagEntryLocation {
  return locations.reduce((best, candidate) => {
    if (candidate.line < best.line) return candidate;
    if (candidate.line === best.line && candidate.character < best.character) return candidate;
    return best;
  }, locations[0]);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}
