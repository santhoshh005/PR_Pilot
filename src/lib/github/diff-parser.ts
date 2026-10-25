import picomatch from "picomatch";
import { DiffChunk, CONFIG } from "@/types";
import { formatGitHubError, isGitHubAuthOrPermissionError } from "@/lib/github/app";

export interface DiffFetcherClient {
  rest: {
    pulls: {
      get: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        mediaType: { format: "diff" };
      }) => Promise<{ data: unknown }>;
    };
  };
}

export interface HunkInfo {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Set<number>;
  addedLines: Set<number>;
  rawText: string;
}

export interface FileDiffInfo {
  filePath: string;
  oldPath?: string;
  isDeleted: boolean;
  isRenamed: boolean;
  isBinary: boolean;
  hunks: HunkInfo[];
  allLineNumbers: Set<number>;
}

export interface ParsedDiffChunk extends DiffChunk {
  hunk_line_numbers?: Set<number>;
  line_numbers?: Set<number>;
  hunks?: HunkInfo[];
  file_hunk_line_numbers?: Map<string, Set<number>>;
  file_paths?: string[];
}

export interface ParseDiffResult extends Array<ParsedDiffChunk> {
  fileHunkLines?: Map<string, Set<number>[]>;
  fileLineNumbers?: Map<string, Set<number>>;
  files?: FileDiffInfo[];
}

export interface ParseDiffOptions {
  ignoredPaths?: string[];
  maxTokens?: number;
}

/**
 * Fetches the unified diff for a pull request via Octokit using the diff media type.
 */
export async function fetchDiff(
  octokit: DiffFetcherClient,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  try {
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: "diff",
      },
    });

    if (typeof response.data !== "string") {
      throw new Error("Expected diff format response from GitHub API");
    }

    return response.data;
  } catch (err: unknown) {
    if (isGitHubAuthOrPermissionError(err)) {
      throw new Error(formatGitHubError(err, "pulls.get diff"));
    }
    throw err;
  }
}

const MAX_IGNORED_PATTERNS = 100;
const MAX_PATTERN_LENGTH = 300;

/**
 * Checks if a file path matches any pattern in the ignored_paths list using safe glob matching.
 */
export function isPathIgnored(filePath: string, ignoredPaths: string[]): boolean {
  if (!ignoredPaths || ignoredPaths.length === 0 || !filePath) {
    return false;
  }

  const safePatterns = ignoredPaths
    .slice(0, MAX_IGNORED_PATTERNS)
    .filter((p) => typeof p === "string" && p.length > 0 && p.length <= MAX_PATTERN_LENGTH);

  if (safePatterns.length === 0) {
    return false;
  }

  try {
    const expandedPatterns = safePatterns.flatMap((p) =>
      p.includes("/") ? [p] : [p, `**/${p}`]
    );
    const isMatch = picomatch(expandedPatterns, { dot: true });
    return isMatch(filePath);
  } catch {
    return false;
  }
}

/**
 * Parses raw unified diff text into FileDiffInfo objects.
 */
export function parseDiffFiles(diffText: string, ignoredPaths: string[] = []): FileDiffInfo[] {
  const fileBlocks = splitIntoFileBlocks(diffText);
  const files: FileDiffInfo[] = [];

  for (const block of fileBlocks) {
    const file = parseSingleFileBlock(block);
    if (!file) continue;
    if (isPathIgnored(file.filePath, ignoredPaths)) continue;
    files.push(file);
  }

  return files;
}

function splitIntoFileBlocks(diffText: string): string[] {
  const lines = diffText.split("\n");
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && currentBlock.length > 0) {
      blocks.push(currentBlock.join("\n"));
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0 && currentBlock.some((l) => l.trim().length > 0)) {
    blocks.push(currentBlock.join("\n"));
  }

  return blocks;
}

function parseSingleFileBlock(block: string): FileDiffInfo | null {
  const lines = block.split("\n");
  const firstLine = lines[0] || "";
  let oldPath = "";
  let newPath = "";
  let isDeleted = false;
  let isRenamed = false;
  let isBinary = false;

  const gitMatch = firstLine.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (gitMatch) {
    oldPath = gitMatch[1].trim().replace(/^"|"$/g, "");
    newPath = gitMatch[2].trim().replace(/^"|"$/g, "");
  }

  for (const line of lines) {
    if (line.startsWith("deleted file mode")) isDeleted = true;
    if (line.startsWith("rename from ")) oldPath = line.substring(12).trim().replace(/^"|"$/g, "");
    if (line.startsWith("rename to ")) {
      newPath = line.substring(10).trim().replace(/^"|"$/g, "");
      isRenamed = true;
    }
    if (line.startsWith("--- a/")) oldPath = line.substring(6).trim().replace(/^"|"$/g, "");
    if (line.startsWith("+++ b/")) newPath = line.substring(6).trim().replace(/^"|"$/g, "");
    if (line.startsWith("+++ /dev/null")) isDeleted = true;
    if (line.includes("Binary files ") || line.startsWith("GIT binary patch")) isBinary = true;
  }

  const filePath = isDeleted ? oldPath : newPath || oldPath;
  if (!filePath) return null;

  const hunks = isBinary ? [] : parseHunks(lines);
  const allLineNumbers = new Set<number>();
  for (const hunk of hunks) {
    for (const num of hunk.lines) {
      allLineNumbers.add(num);
    }
  }

  return { filePath, oldPath, isDeleted, isRenamed, isBinary, hunks, allLineNumbers };
}

function parseHunks(lines: string[]): HunkInfo[] {
  const hunks: HunkInfo[] = [];
  let currentHeader = "";
  let currentOldStart = 0;
  let currentOldLines = 0;
  let currentNewStart = 0;
  let currentNewLines = 0;
  let hunkRawLines: string[] = [];

  const flushHunk = () => {
    if (!currentHeader) return;
    const { lines: hunkLines, addedLines } = calculateHunkLines(
      currentNewStart,
      currentNewLines,
      currentOldStart,
      currentOldLines,
      hunkRawLines
    );
    hunks.push({
      header: currentHeader,
      oldStart: currentOldStart,
      oldLines: currentOldLines,
      newStart: currentNewStart,
      newLines: currentNewLines,
      lines: hunkLines,
      addedLines,
      rawText: [currentHeader, ...hunkRawLines].join("\n"),
    });
  };

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      flushHunk();
      currentHeader = line;
      currentOldStart = parseInt(hunkMatch[1], 10);
      currentOldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      currentNewStart = parseInt(hunkMatch[3], 10);
      currentNewLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      hunkRawLines = [];
    } else if (currentHeader) {
      hunkRawLines.push(line);
    }
  }

  flushHunk();
  return hunks;
}

function calculateHunkLines(
  newStart: number,
  newLines: number,
  _oldStart: number,
  _oldLines: number,
  rawLines: string[]
) {
  const lines = new Set<number>();
  const addedLines = new Set<number>();

  if (newLines === 0) {
    return { lines, addedLines };
  }

  let currentNew = newStart;

  for (const line of rawLines) {
    if (line.startsWith("+")) {
      lines.add(currentNew);
      addedLines.add(currentNew);
      currentNew++;
    } else if (line.startsWith("-")) {
      // deleted line in old file
    } else if (line.startsWith(" ")) {
      lines.add(currentNew);
      currentNew++;
    }
  }

  return { lines, addedLines };
}

/**
 * Returns a map of file path to array of Sets of new-file line numbers for each hunk.
 */
export function getHunkLineNumbers(diffText: string): Map<string, Set<number>[]> {
  const files = parseDiffFiles(diffText);
  const map = new Map<string, Set<number>[]>();
  for (const file of files) {
    map.set(file.filePath, file.hunks.map((h) => h.lines));
  }
  return map;
}

/**
 * Returns a map of file path to the complete set of new-file line numbers across all hunks.
 */
export function getFileLineNumbers(diffText: string): Map<string, Set<number>> {
  const files = parseDiffFiles(diffText);
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    map.set(file.filePath, file.allLineNumbers);
  }
  return map;
}

/**
 * Splits unified diff into per-file chunks respecting token size limits without splitting lines.
 */
export function parseDiff(
  diffText: string,
  optionsOrIgnoredPaths?: string[] | ParseDiffOptions
): ParseDiffResult {
  const { ignoredPaths, maxTokens } = normalizeOptions(optionsOrIgnoredPaths);
  const files = parseDiffFiles(diffText, ignoredPaths);
  const chunks: ParsedDiffChunk[] = [];
  let chunkIndex = 0;

  for (const file of files) {
    if (file.isBinary || file.hunks.length === 0) continue;

    const fileChunks = chunkFileHunks(file, maxTokens, chunkIndex);
    for (const chunk of fileChunks) {
      chunks.push(chunk);
      chunkIndex++;
    }
  }

  return decorateResult(chunks, files);
}

function normalizeOptions(opts?: string[] | ParseDiffOptions): {
  ignoredPaths: string[];
  maxTokens: number;
} {
  if (Array.isArray(opts)) {
    return { ignoredPaths: opts, maxTokens: CONFIG.MAX_CHUNK_TOKENS };
  }
  return {
    ignoredPaths: opts?.ignoredPaths ?? [],
    maxTokens: opts?.maxTokens ?? CONFIG.MAX_CHUNK_TOKENS,
  };
}

function chunkFileHunks(
  file: FileDiffInfo,
  maxTokens: number,
  startIndex: number
): ParsedDiffChunk[] {
  const maxChars = maxTokens * 4;
  const fullContent = file.hunks.map((h) => h.rawText).join("\n") + "\n";

  if (fullContent.length <= maxChars) {
    return [createChunk(startIndex, file.filePath, fullContent, file.hunks, file.allLineNumbers)];
  }

  return splitLargeFile(file, maxChars, startIndex);
}

function splitLargeFile(
  file: FileDiffInfo,
  maxChars: number,
  startIndex: number
): ParsedDiffChunk[] {
  const chunks: ParsedDiffChunk[] = [];
  let currentLines: string[] = [];
  let currentLineNumbers = new Set<number>();
  let currentIndex = startIndex;
  let isContinuation = false;
  let chunkOldStart = 0;
  let chunkNewStart = 0;

  const flush = () => {
    if (currentLines.length === 0) return;
    const finalLines = isContinuation
      ? [formatContinuationHeader(currentLines, chunkOldStart, chunkNewStart), ...currentLines]
      : currentLines;
    chunks.push(flushChunk(currentIndex++, file.filePath, finalLines, currentLineNumbers));
    currentLines = [];
    currentLineNumbers = new Set();
  };

  for (const hunk of file.hunks) {
    const hunkLines = hunk.rawText.split("\n");
    let currentNew = hunk.newStart;
    let currentOld = hunk.oldStart;

    for (let i = 0; i < hunkLines.length; i++) {
      const line = hunkLines[i];
      if (i === 0 && line.startsWith("@@")) {
        if (currentLines.length > 0) {
          flush();
          isContinuation = false;
        }
        currentLines.push(line);
        continue;
      }

      const lineLen = line.length + 1;
      const currentLen = currentLines.join("\n").length;
      const headerAllowance = isContinuation ? 40 : 0;

      if (currentLines.length > 0 && currentLen + lineLen + headerAllowance > maxChars) {
        flush();
        isContinuation = true;
        chunkOldStart = currentOld;
        chunkNewStart = currentNew;
      }

      currentLines.push(line);
      if (line.startsWith("+")) {
        currentLineNumbers.add(currentNew);
        currentNew++;
      } else if (line.startsWith("-")) {
        currentOld++;
      } else if (line.startsWith(" ")) {
        currentLineNumbers.add(currentNew);
        currentNew++;
        currentOld++;
      }
    }

    if (currentLines.length > 0) {
      flush();
      isContinuation = false;
    }
  }

  return chunks;
}

function formatContinuationHeader(lines: string[], oldStart: number, newStart: number): string {
  const oldLen = lines.filter((l) => l.startsWith("-") || l.startsWith(" ")).length;
  const newLen = lines.filter((l) => l.startsWith("+") || l.startsWith(" ")).length;
  return `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`;
}

function flushChunk(
  index: number,
  filePath: string,
  lines: string[],
  lineNumbers: Set<number>
): ParsedDiffChunk {
  const content = lines.join("\n") + "\n";
  return {
    index,
    file_path: filePath,
    content,
    token_estimate: Math.ceil(content.length / 4),
    hunk_line_numbers: lineNumbers,
    line_numbers: lineNumbers,
  };
}

function createChunk(
  index: number,
  filePath: string,
  content: string,
  hunks: HunkInfo[],
  allLineNumbers: Set<number>
): ParsedDiffChunk {
  return {
    index,
    file_path: filePath,
    content,
    token_estimate: Math.ceil(content.length / 4),
    hunk_line_numbers: allLineNumbers,
    line_numbers: allLineNumbers,
    hunks,
  };
}

function decorateResult(chunks: ParsedDiffChunk[], files: FileDiffInfo[]): ParseDiffResult {
  const result = chunks as ParseDiffResult;
  result.files = files;

  const fileHunkLines = new Map<string, Set<number>[]>();
  const fileLineNumbers = new Map<string, Set<number>>();

  for (const file of files) {
    fileHunkLines.set(file.filePath, file.hunks.map((h) => h.lines));
    fileLineNumbers.set(file.filePath, file.allLineNumbers);
  }

  result.fileHunkLines = fileHunkLines;
  result.fileLineNumbers = fileLineNumbers;

  return result;
}
