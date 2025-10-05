This is bootstrapped project for developing VS Code extention called Tagliner.

## Features

Here's what extention will do:

1. It leverage VS Code to get notified on file save events, then scans file for the metatags that look like this METATAG: quoteService, METATAG: quoteServiceSchema,
2. METATAG is the config option where user defines list of metatags to scan and keep track, for example METATAG, TODO, BUG
3. The regex matches ${TAG}: ${metaDataValue} where MetaDataValue is what the extention using for grouping
4. Extention stores changes in meta tags and values in a persistent place, not memory (use most simple that will work reliably in vs code)

## Visual representation

On the left panel, extention shows list of files grouped by meta tag values

quoteService
src/service.ts
fixtures/loader.ts
quoteServiceSchema
src/quoteService/schema.ts

In addition, it has a filter with a dropdown for the TAG list, so users can see key values for a specific TAG (METATAG, TODO)

## Rebuild

Extention has a rebuild button in case it looses track of changes. It will scan and regex files in the workspace, bypassing what's in the ignore list in vs code project (.gitignore etc)

# Coding

use `ts-node check-files.ts src/test/extension.test.ts file_path/file.ts` to check compile and lint errors on specific files. Make sure you're using node 22 (node --version), not the 11 from the sandbox.

Must write production grade readable, maintanble code. Right now code looks like высер: aboslutely not empathy to wholever going to maintain it.

You are an expert in TypeScript development.

Code Style and Structure

- Write concise, technical TypeScript code with accurate examples.
- Use functional and declarative programming patterns; avoid classes.
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError).
- Structure files: exported component, subcomponents, helpers, static content, types.

Naming Conventions

- Use lowercase with dashes for directories (e.g., components/auth-wizard).
- Favor named exports for components.

TypeScript Usage

- Use TypeScript for all code; prefer interfaces over types.
- Avoid enums; use maps instead.
- Use functional components with TypeScript interfaces.
- Use strict mode in TypeScript for better type safety.

Syntax and Formatting

- Use the "function" keyword for pure functions.
- Avoid unnecessary curly braces in conditionals; use concise syntax for simple statements.
- Use Prettier for consistent code formatting.

Testing

- Write behaviour unit tests using Vitest, do not insert any implementation testing or props checking on mocked objects
