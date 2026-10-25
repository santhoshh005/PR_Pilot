import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  fetchDiff,
  parseDiff,
  getHunkLineNumbers,
  getFileLineNumbers,
  isPathIgnored,
  DiffFetcherClient,
} from "./diff-parser";

const sampleDiffPath = path.resolve(__dirname, "../../__fixtures__/sample-diff.txt");
const sampleDiff = fs.readFileSync(sampleDiffPath, "utf-8");

describe("fetchDiff", () => {
  it("fetches the PR diff using mediaType { format: 'diff' }", async () => {
    const mockOctokit: DiffFetcherClient = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: "diff --git a/foo.ts b/foo.ts\n@@ -1,1 +1,2 @@\n context\n+new line\n",
          }),
        },
      },
    };

    const diff = await fetchDiff(mockOctokit, "owner-name", "repo-name", 42);

    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "owner-name",
      repo: "repo-name",
      pull_number: 42,
      mediaType: {
        format: "diff",
      },
    });
    expect(diff).toContain("diff --git a/foo.ts b/foo.ts");
  });

  it("throws if response data is not a string", async () => {
    const mockOctokit: DiffFetcherClient = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: { error: "not a diff" },
          }),
        },
      },
    };

    await expect(fetchDiff(mockOctokit, "owner", "repo", 1)).rejects.toThrow(
      /diff/i
    );
  });

  it("formats simulated 403 error with accepted permissions and request_id without secrets", async () => {
    const errorWithHeaders = Object.assign(
      new Error("Resource not accessible by integration"),
      {
        status: 403,
        response: {
          status: 403,
          headers: {
            "x-accepted-github-permissions": "pull_requests=read",
            "x-github-request-id": "REQ-123-ABC",
          },
        },
      }
    );

    const mockOctokit: DiffFetcherClient = {
      rest: {
        pulls: {
          get: vi.fn().mockRejectedValue(errorWithHeaders),
        },
      },
    };

    await expect(fetchDiff(mockOctokit, "owner", "repo", 1)).rejects.toThrowError(
      "GitHub 403 at pulls.get diff: accepted=[pull_requests=read], request_id=REQ-123-ABC"
    );
  });

  it("handles missing headers on 403 gracefully with 'none'", async () => {
    const errorWithoutHeaders = Object.assign(
      new Error("Resource not accessible by integration"),
      {
        status: 403,
        response: {
          status: 403,
          headers: {},
        },
      }
    );

    const mockOctokit: DiffFetcherClient = {
      rest: {
        pulls: {
          get: vi.fn().mockRejectedValue(errorWithoutHeaders),
        },
      },
    };

    await expect(fetchDiff(mockOctokit, "owner", "repo", 1)).rejects.toThrowError(
      "GitHub 403 at pulls.get diff: accepted=[none], request_id=none"
    );
  });
});

describe("parseDiff - fixture parsing", () => {
  it("splits sample unified diff into chunks with correct file paths and token estimates", () => {
    const chunks = parseDiff(sampleDiff);

    // Active files in fixture:
    // 1. src/utils.ts
    // 2. src/components/button.tsx
    // 3. config/new-name.json (renamed)
    // 4. docs/deprecated.md (deleted)
    // 5. README.md
    // (assets/logo.png is binary, so skipped)
    const filePaths = chunks.map((c) => c.file_path);

    expect(filePaths).toContain("src/utils.ts");
    expect(filePaths).toContain("src/components/button.tsx");
    expect(filePaths).toContain("config/new-name.json");
    expect(filePaths).toContain("README.md");
    // Binary file should not produce review chunks
    expect(filePaths).not.toContain("assets/logo.png");

    chunks.forEach((chunk, idx) => {
      expect(chunk.index).toBe(idx);
      expect(chunk.token_estimate).toBeGreaterThan(0);
      expect(chunk.token_estimate).toBe(Math.ceil(chunk.content.length / 4));
    });
  });
});

describe("parseDiff - line numbers recording", () => {
  it("records per file the exact set of new-file line numbers that appear in each hunk", () => {
    const chunks = parseDiff(sampleDiff);
    const utilsChunk = chunks.find((c) => c.file_path === "src/utils.ts");
    expect(utilsChunk).toBeDefined();

    // In sample-diff.txt for src/utils.ts:
    // Hunk 1: @@ -5,6 +5,8 @@
    //  export function formatHeader(title: string): string { -> line 5
    //    const trimmed = title.trim();                       -> line 6
    //  +  if (!trimmed) {                                    -> line 7
    //  +    return "Default Header";                         -> line 8
    //  +  }                                                  -> line 9
    //    return `[HEADER] ${trimmed}`;                       -> line 10
    //  }                                                     -> line 11
    // (Total 8 lines on new side: lines 5 through 12)
    //
    // Hunk 2: @@ -30,7 +32,9 @@
    // Starts at 32, 9 lines total: lines 32 through 40

    // Check hunk line numbers on the chunk
    expect(utilsChunk?.hunk_line_numbers).toBeDefined();
    expect(utilsChunk?.hunk_line_numbers?.has(5)).toBe(true);
    expect(utilsChunk?.hunk_line_numbers?.has(7)).toBe(true); // added
    expect(utilsChunk?.hunk_line_numbers?.has(8)).toBe(true); // added
    expect(utilsChunk?.hunk_line_numbers?.has(9)).toBe(true); // added
    expect(utilsChunk?.hunk_line_numbers?.has(12)).toBe(true);
    // Line 13 is outside hunk 1 and before hunk 2:
    expect(utilsChunk?.hunk_line_numbers?.has(13)).toBe(false);

    // Hunk 2 lines
    expect(utilsChunk?.hunk_line_numbers?.has(32)).toBe(true);
    expect(utilsChunk?.hunk_line_numbers?.has(36)).toBe(true); // added
    expect(utilsChunk?.hunk_line_numbers?.has(37)).toBe(true); // added
    expect(utilsChunk?.hunk_line_numbers?.has(40)).toBe(true);
    // Line 50 is outside all hunks:
    expect(utilsChunk?.hunk_line_numbers?.has(50)).toBe(false);

    // Also check getHunkLineNumbers helper
    const hunkMap = getHunkLineNumbers(sampleDiff);
    const utilsHunks = hunkMap.get("src/utils.ts");
    expect(utilsHunks).toBeDefined();
    expect(utilsHunks?.length).toBe(2);

    // Hunk 1 line numbers: 5 to 12
    const hunk1 = utilsHunks![0];
    expect(hunk1.has(5)).toBe(true);
    expect(hunk1.has(7)).toBe(true);
    expect(hunk1.has(12)).toBe(true);
    expect(hunk1.has(32)).toBe(false);

    // Hunk 2 line numbers: 32 to 40
    const hunk2 = utilsHunks![1];
    expect(hunk2.has(32)).toBe(true);
    expect(hunk2.has(36)).toBe(true);
    expect(hunk2.has(40)).toBe(true);
    expect(hunk2.has(5)).toBe(false);
  });

  it("checks file-level line numbers with getFileLineNumbers", () => {
    const fileLineMap = getFileLineNumbers(sampleDiff);
    const buttonLines = fileLineMap.get("src/components/button.tsx");
    expect(buttonLines).toBeDefined();

    // Hunk: @@ -1,5 +1,8 @@
    // Lines 1 through 8
    expect(buttonLines?.has(1)).toBe(true);
    expect(buttonLines?.has(3)).toBe(true);
    expect(buttonLines?.has(8)).toBe(true);
    expect(buttonLines?.has(9)).toBe(false);
  });
});

describe("parseDiff - edge cases", () => {
  it("handles renamed file and uses the new file path", () => {
    const diff = `diff --git a/old-dir/old-name.ts b/new-dir/new-name.ts
similarity index 95%
rename from old-dir/old-name.ts
rename to new-dir/new-name.ts
--- a/old-dir/old-name.ts
+++ b/new-dir/new-name.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;
    const chunks = parseDiff(diff);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].file_path).toBe("new-dir/new-name.ts");
    expect(chunks[0].hunk_line_numbers?.has(1)).toBe(true);
    expect(chunks[0].hunk_line_numbers?.has(2)).toBe(true); // new line 2
    expect(chunks[0].hunk_line_numbers?.has(3)).toBe(true);
  });

  it("handles deleted file gracefully without crashing", () => {
    const diff = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
--- a/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line 1
-line 2
-line 3
`;
    const chunks = parseDiff(diff);
    // Deleted file has no new lines
    const deletedChunk = chunks.find((c) => c.file_path === "deleted.ts");
    if (deletedChunk) {
      expect(deletedChunk.hunk_line_numbers?.size).toBe(0);
    }
  });

  it("handles binary file gracefully without crashing", () => {
    const diff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;
    const chunks = parseDiff(diff);
    expect(chunks).toHaveLength(0);
  });

  it("handles \\ No newline at end of file without corrupting line count", () => {
    const diff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,1 @@
-old line
\\ No newline at end of file
+new line
\\ No newline at end of file
`;
    const chunks = parseDiff(diff);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].hunk_line_numbers?.has(1)).toBe(true);
    expect(chunks[0].hunk_line_numbers?.size).toBe(1);
  });

  it("handles mode-only changes without hunks gracefully", () => {
    const diff = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`;
    const chunks = parseDiff(diff);
    expect(chunks).toHaveLength(0);
  });
});

describe("parseDiff - ignored paths", () => {
  it("filters out files matching ignored_paths patterns", () => {
    const ignored = ["docs/**", "config/*.json", "*.png"];
    const chunks = parseDiff(sampleDiff, { ignoredPaths: ignored });

    const filePaths = chunks.map((c) => c.file_path);
    expect(filePaths).not.toContain("docs/deprecated.md");
    expect(filePaths).not.toContain("config/new-name.json");
    expect(filePaths).toContain("src/utils.ts");
    expect(filePaths).toContain("src/components/button.tsx");
  });

  it("supports string array as second argument directly", () => {
    const chunks = parseDiff(sampleDiff, ["docs/**", "README.md"]);
    const filePaths = chunks.map((c) => c.file_path);
    expect(filePaths).not.toContain("docs/deprecated.md");
    expect(filePaths).not.toContain("README.md");
    expect(filePaths).toContain("src/utils.ts");
  });
});

describe("parseDiff - chunking large diffs", () => {
  it("splits a large diff into multiple chunks respecting the size limit without splitting a line", () => {
    // Generate a file with 100 lines of code
    const lines: string[] = [];
    for (let i = 1; i <= 100; i++) {
      lines.push(`+const line${i} = "this is a somewhat long line of code for testing chunking ${i}";`);
    }
    const largeDiff = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
@@ -0,0 +1,100 @@
${lines.join("\n")}
`;

    // Limit to 200 tokens (approx 800 characters)
    const maxTokens = 200;
    const chunks = parseDiff(largeDiff, { maxTokens });

    expect(chunks.length).toBeGreaterThan(1);

    // Verify all chunks:
    // 1. None should split a line: every line inside hunk content should start with +, -, ' ', or @@
    // 2. Each chunk should respect token limit
    // 3. Line numbers are preserved across chunks
    let totalLinesFound = 0;
    for (const chunk of chunks) {
      expect(chunk.file_path).toBe("large.ts");
      expect(chunk.token_estimate).toBeLessThanOrEqual(maxTokens + 10); // small tolerance for single oversized lines

      // Every line in chunk diff content must be complete
      const chunkLines = chunk.content.split("\n").filter((l) => l.trim().length > 0);
      for (const line of chunkLines) {
        const isHeaderOrDiffLine =
          line.startsWith("@@") ||
          line.startsWith("+") ||
          line.startsWith("-") ||
          line.startsWith(" ") ||
          line.startsWith("\\");
        expect(isHeaderOrDiffLine).toBe(true);
      }

      totalLinesFound += chunk.hunk_line_numbers?.size || 0;
    }

    expect(totalLinesFound).toBe(100);
  });

  it("preserves continuous absolute line numbers in chunk 2 and subsequent chunks when a large file is split", () => {
    // Generate diff with oldStart = 50, newStart = 100
    // Contains context, removed, and added lines
    const diffLines: string[] = [];
    for (let i = 0; i < 15; i++) {
      diffLines.push(` context line before ${i}`);
    }
    for (let i = 0; i < 20; i++) {
      diffLines.push(`-removed old line ${i}`);
    }
    for (let i = 0; i < 35; i++) {
      diffLines.push(`+added new line ${i} with sufficient padding to trigger chunking`);
    }
    for (let i = 0; i < 15; i++) {
      diffLines.push(` context line after ${i}`);
    }

    const largeDiff = `diff --git a/mixed.ts b/mixed.ts
--- a/mixed.ts
+++ b/mixed.ts
@@ -50,50 +100,65 @@
${diffLines.join("\n")}
`;

    // Split with low maxTokens to force multiple chunks
    const chunks = parseDiff(largeDiff, { maxTokens: 120 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const chunk1Lines = Array.from(chunks[0].hunk_line_numbers || []).sort((a, b) => a - b);
    const chunk2Lines = Array.from(chunks[1].hunk_line_numbers || []).sort((a, b) => a - b);

    expect(chunk1Lines.length).toBeGreaterThan(0);
    expect(chunk2Lines.length).toBeGreaterThan(0);

    const chunk1EndLine = chunk1Lines[chunk1Lines.length - 1];
    const chunk2StartLine = chunk2Lines[0];

    // Assert that chunk 2's hunk_line_numbers starts exactly where chunk 1 ended (no gap, no overlap)
    expect(chunk2StartLine).toBe(chunk1EndLine + 1);

    // No overlap
    for (const line of chunk1Lines) {
      expect(chunks[1].hunk_line_numbers?.has(line)).toBe(false);
    }

    // Assert that chunk 2's content begins with a valid synthetic hunk header
    const firstLineChunk2 = chunks[1].content.split("\n")[0];
    const headerMatch = firstLineChunk2.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    expect(headerMatch).not.toBeNull();

    const [, oldStartStr, oldLenStr, newStartStr, newLenStr] = headerMatch!;
    const oldStart = Number(oldStartStr);
    const oldLen = Number(oldLenStr);
    const newStart = Number(newStartStr);
    const newLen = Number(newLenStr);

    // whose newStart equals the first new-file line in that chunk
    expect(newStart).toBe(chunk2StartLine);
    expect(newLen).toBe(chunk2Lines.length);

    // Check old-side counts too, including chunks that contain removed lines
    const chunk1ContentLines = chunks[0].content
      .split("\n")
      .filter((l) => l.startsWith("-") || l.startsWith(" "));
    const expectedChunk2OldStart = 50 + chunk1ContentLines.length;
    expect(oldStart).toBe(expectedChunk2OldStart);

    const chunk2ContentOldLines = chunks[1].content
      .split("\n")
      .filter((l) => l.startsWith("-") || l.startsWith(" "));
    expect(oldLen).toBe(chunk2ContentOldLines.length);
  });

  describe("Group C - isPathIgnored with safe glob library (picomatch)", () => {
    it("evaluates a pathological nested glob pattern quickly without ReDoS", () => {
      const pathological = "a]]**/b]]**/c]]**/d]]**/e]]**/f]]**";
      const start = Date.now();
      const result = isPathIgnored("a/b/c/d/e/f/target.ts", [pathological]);
      const durationMs = Date.now() - start;

      expect(durationMs).toBeLessThan(50);
      expect(typeof result).toBe("boolean");
    });

    it("caps pattern length and ignores oversized patterns (>300 chars)", () => {
      const hugePattern = "a".repeat(400) + "/**";
      const result = isPathIgnored("src/file.ts", [hugePattern]);
      expect(result).toBe(false);
    });

    it("caps pattern count to 100", () => {
      const manyPatterns = Array.from({ length: 150 }, (_, i) => `ignore_${i}.ts`);
      // 101st pattern should be ignored by the slice cap
      expect(isPathIgnored("ignore_120.ts", manyPatterns)).toBe(false);
      expect(isPathIgnored("ignore_5.ts", manyPatterns)).toBe(true);
    });
  });
});
