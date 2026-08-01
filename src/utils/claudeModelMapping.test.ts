import { describe, expect, it } from "vitest";
import { selectLatestClaudeRoleModels } from "./claudeModelMapping";

describe("Claude model role mapping", () => {
  it("selects the newest available model for each role", () => {
    expect(
      selectLatestClaudeRoleModels([
        "claude-opus-4-6",
        "claude-opus-4-8",
        "claude-opus-5",
        "claude-sonnet-4-6",
        "claude-sonnet-5",
        "claude-haiku-4-5-20251001",
      ]),
    ).toEqual({
      sonnet: "claude-sonnet-5",
      opus: "claude-opus-5",
      haiku: "claude-haiku-4-5-20251001",
    });
  });

  it("keeps missing roles absent instead of inventing unavailable models", () => {
    const mapping = selectLatestClaudeRoleModels([
      "claude-sonnet-5",
      "claude-opus-5",
    ]);

    expect(mapping.fable).toBeUndefined();
    expect(mapping.haiku).toBeUndefined();
  });

  it("selects Fable when the current provider actually exposes it", () => {
    expect(
      selectLatestClaudeRoleModels(["claude-fable-4-8", "claude-fable-5"]),
    ).toEqual({
      fable: "claude-fable-5",
    });
  });
});
