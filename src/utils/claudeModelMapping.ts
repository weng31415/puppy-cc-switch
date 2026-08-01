export const CLAUDE_MODEL_ROLES = ["sonnet", "opus", "fable", "haiku"] as const;

export type ClaudeModelRole = (typeof CLAUDE_MODEL_ROLES)[number];

export type ClaudeRoleModelMapping = Partial<Record<ClaudeModelRole, string>>;

function numericSegments(modelId: string): number[] {
  return Array.from(modelId.matchAll(/\d+/g), (match) => Number(match[0]));
}

function compareModelFreshness(left: string, right: string): number {
  const leftSegments = numericSegments(left);
  const rightSegments = numericSegments(right);
  const length = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftSegments[index] ?? -1;
    const rightValue = rightSegments[index] ?? -1;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return left.localeCompare(right);
}

export function selectLatestClaudeRoleModels(
  modelIds: string[],
): ClaudeRoleModelMapping {
  const normalizedIds = Array.from(
    new Set(modelIds.map((id) => id.trim()).filter(Boolean)),
  );
  const mapping: ClaudeRoleModelMapping = {};

  for (const role of CLAUDE_MODEL_ROLES) {
    const candidates = normalizedIds
      .filter((id) => id.toLowerCase().includes(role))
      .sort(compareModelFreshness);
    const latest = candidates.at(-1);
    if (latest) {
      mapping[role] = latest;
    }
  }

  return mapping;
}
