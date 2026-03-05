// utils/ruleDuplicateChecker.ts

/**
 * Checks for duplicate rules in a rule array.
 * @param rules Array of rule objects (pod or node rules)
 * @param normalizeRule Function to normalize a rule for comparison (e.g., sort conditions, remove non-essential fields)
 * @returns { duplicates: boolean, indices: number[] }
 */
export function checkForDuplicateRules<T>(
  rules: T[],
  normalizeRule: (rule: T) => any
): { duplicates: boolean; indices: number[] } {
  const seen = new Map<string, number>();
  const duplicateIndices: number[] = [];

  rules.forEach((rule, idx) => {
    const norm = JSON.stringify(normalizeRule(rule));
    if (seen.has(norm)) {
      duplicateIndices.push(idx, seen.get(norm)!);
    } else {
      seen.set(norm, idx);
    }
  });

  return {
    duplicates: duplicateIndices.length > 0,
    indices: Array.from(new Set(duplicateIndices)),
  };
}

// Example normalization function for pod rules
export function normalizePodRule(rule: any) {
  return {
    severity: rule.severity,
    description: rule.description,
    overrideCondition: rule.overrideCondition,
    useCustomQuery: rule.useCustomQuery,
    customQueryText: rule.customQueryText,
    // Sort conditions for consistent comparison
    conditions: rule.conditions
      .map((c: any) => ({
        pod: c.pod,
        query: c.query,
        threshold: c.threshold,
        operator: c.operator,
        comparisonOperator: c.comparisonOperator,
        unit: c.unit,
      }))
      .sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

// Example normalization function for node rules
export function normalizeNodeRule(rule: any) {
  return {
    severity: rule.severity,
    description: rule.description,
    useCustomQuery: rule.useCustomQuery,
    customQueryText: rule.customQueryText,
    conditions: rule.conditions
      .map((c: any) => ({
        vmType: c.vmType,
        query: c.query,
        threshold: c.threshold,
        operator: c.operator,
        comparisonOperator: c.comparisonOperator,
        unit: c.unit,
      }))
      .sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
