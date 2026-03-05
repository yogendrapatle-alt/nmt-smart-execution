// configUtils.ts
export function parseConfigJson(config: any) {
  if (!config) throw new Error('Invalid config format');
  const { Rules } = config;
  let ruleBook: any[] = [];
  if (Rules && typeof Rules === 'object') {
    // Handle both Pod Rules and Node Rules
    Object.values(Rules).forEach((group: any) => {
      if (group && typeof group === 'object') {
        Object.values(group).forEach((rule: any) => {
          if (!rule) return;
          ruleBook.push({
            severity: rule.severity,
            description: rule.description,
            overrideCondition: rule.override_condition,
            useCustomQuery: !!rule.condition?.[0]?.expr,
            customQueryText: rule.condition?.[0]?.expr || '',
            conditions: !rule.condition?.[0]?.expr
              ? (Array.isArray(rule.condition) ? rule.condition.filter((c: any) => c.query).map((c: any) => ({
                  pod: c.pod_name,
                  query: c.query,
                  threshold: c.value,
                  operator: c.logical_operator,
                  comparisonOperator: c.operator,
                  unit: c.unit,
                })) : [])
              : [],
          });
        });
      }
    });
  }
  // Return other fields as needed
  return { ruleBook };
}
