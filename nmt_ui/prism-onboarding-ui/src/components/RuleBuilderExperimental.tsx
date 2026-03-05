import React, { useState, useEffect } from 'react';
import { checkForDuplicateRules } from '../utils/ruleDuplicateChecker';

// Normalization for duplicate detection: match output JSON structure
function normalizePodRule(rule: any) {
  // If custom query, use customQueryText for normalization
  if (rule.useCustomQuery && rule.customQueryText) {
    return [
      rule.severity || '',
      rule.description || '',
      'CUSTOM',
      rule.customQueryText.trim()
    ].join('||');
  }
  // Only consider rules with the same number of conditions as duplicates
  if (!rule.conditions || !Array.isArray(rule.conditions)) return '';
  const conds = rule.conditions.map((cond: any) => {
    return [
      cond.namespace || '',
      cond.pod || cond.pod_name || '',
      cond.query || '',
      cond.comparisonOperator || cond.operator || '',
      cond.threshold || cond.value || '',
      cond.unit || ''
    ].join('|');
  });
  return [
    rule.severity || '',
    rule.description || '',
    conds.join(';')
  ].join('||');
}

function normalizeNodeRule(rule: any) {
  if (rule.useCustomQuery && rule.customQueryText) {
    return [
      rule.severity || '',
      rule.description || '',
      'CUSTOM',
      rule.customQueryText.trim()
    ].join('||');
  }
  if (!rule.conditions || !Array.isArray(rule.conditions)) return '';
  const conds = rule.conditions.map((cond: any) => {
    return [
      cond.vmType || '',
      cond.query || '',
      cond.comparisonOperator || cond.operator || '',
      cond.threshold || cond.value || '',
      cond.unit || ''
    ].join('|');
  });
  return [
    rule.severity || '',
    rule.description || '',
    conds.join(';')
  ].join('||');
}
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { saveAs } from 'file-saver';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../context/OnboardingContext';
import type { RuleConfig, MetricConfig } from '../types/onboarding';
import Select from 'react-select';


import nameAndPodDataRaw from '../name-and-pod.json';
import metricAndThresholdDataRaw from '../metric-and-threshold.json';
import vmTypesDataRaw from '../vm-types.json';
import nodeQueriesRaw from '../node-queries.json';
import podQueriesRaw from '../pod-queries.json';

// Add index signatures for JSON imports
const nameAndPodData: { [namespace: string]: string[] } = nameAndPodDataRaw as any;
const metricAndThresholdData: { [query: string]: { defaultThreshold?: string } } = metricAndThresholdDataRaw as any;


const namespaceOptions = Object.keys(nameAndPodData).map(ns => ({ value: ns, label: ns }));




import ConfigUploader from './ConfigUploader';
import { parseConfigJson } from './configUtils';
import { useConfigLoader } from '../hooks/useConfigLoader';
import CustomScriptNavButton from './CustomScriptNavButton';
import CustomScriptUploader from './CustomScriptUploader';
import CustomRuleBuilder from './CustomRuleBuilder';

interface RuleBuilderExperimentalProps {
  onSave: (rule: RuleConfig) => void;
  initialConfig?: any;
  testbedContext?: {
    unique_testbed_id?: string;
    testbed?: any;
    simpleMode?: boolean;
  };
}

const RuleBuilderExperimental: React.FC<RuleBuilderExperimentalProps> = ({ onSave, initialConfig, testbedContext }) => {
  // Simple mode for Rule Config Manager (hide complex options)
  const isSimpleMode = testbedContext?.simpleMode || false;
  // Handler for config upload
  const handleConfigLoaded = (json: any) => {
    console.log('[DEBUG] handleConfigLoaded received:', JSON.stringify(json, null, 2));
    try {
      // Support nested rule groups (e.g., 'Pod Rules', 'Node Rules')
      const config = json?.Config;
      if (!config || !config.Rules || typeof config.Rules !== 'object') {
        throw new Error('Invalid config format: missing Config or Rules');
      }

      // Separate pod rules and node rules
      const allRuleObjs: any[] = [];
      const allNodeRuleObjs: any[] = [];
      Object.entries(config.Rules).forEach(([groupName, group]: [string, any]) => {
        if (typeof group === 'object' && group !== null) {
          // Heuristic: group name contains 'node' => node rules, else pod rules
          if (/node/i.test(groupName)) {
            Object.values(group).forEach((rule: any) => {
              allNodeRuleObjs.push(rule);
            });
          } else {
            Object.values(group).forEach((rule: any) => {
              allRuleObjs.push(rule);
            });
          }
        }
      });

      // Build ruleBook for UI: map each rule to RuleBookEntry format
      const ruleBook: RuleBookEntry[] = allRuleObjs.map((rule: any) => {
        if (Array.isArray(rule.condition) && rule.condition.length === 1 && rule.condition[0].expr) {
          return {
            conditions: [],
            severity: rule.severity || 'Moderate',
            description: rule.description || '',
            overrideCondition: rule.override_condition || '',
            useCustomQuery: true,
            customQueryText: rule.condition[0].expr
          };
        }
        // Parse conditions and logical operators
        const conditions: RuleCondition[] = [];
        if (Array.isArray(rule.condition)) {
          let nextOperator: 'AND' | 'OR' = 'AND';
          for (let i = 0; i < rule.condition.length; i++) {
            const cond = rule.condition[i];
            if (cond.logical_operator) {
              // Set the operator for the previous condition
              if (conditions.length > 0) {
                conditions[conditions.length - 1].operator = cond.logical_operator;
              }
              nextOperator = cond.logical_operator;
            } else {
              conditions.push({
                pod: cond.pod_name || '',
                query: cond.query || '',
                threshold: cond.value !== undefined ? String(cond.value) : '',
                operator: nextOperator,
                comparisonOperator: cond.operator === '<' ? '<' : '>',
                unit: cond.unit || 'Memory (GB)'
              });
              nextOperator = 'AND'; // Default for next unless overwritten
            }
          }
        }
        return {
          conditions,
          severity: rule.severity || 'Moderate',
          description: rule.description || '',
          overrideCondition: rule.override_condition || '',
          useCustomQuery: false,
          customQueryText: ''
        };
      });
      setRuleBook(ruleBook);

      // Build nodeRuleBook for UI: map each node rule to NodeRuleBookEntry format
      const nodeRuleBookEntries: NodeRuleBookEntry[] = allNodeRuleObjs.map((rule: any) => {
        if (Array.isArray(rule.condition) && rule.condition.length === 1 && rule.condition[0].expr) {
          return {
            conditions: [],
            severity: rule.severity || 'Moderate',
            description: rule.description || '',
            useCustomQuery: true,
            customQueryText: rule.condition[0].expr
          };
        }
        // Parse conditions and logical operators
        const conditions: NodeRuleCondition[] = [];
        if (Array.isArray(rule.condition)) {
          let nextOperator: 'AND' | 'OR' = 'AND';
          for (let i = 0; i < rule.condition.length; i++) {
            const cond = rule.condition[i];
            if (cond.logical_operator) {
              if (conditions.length > 0) {
                conditions[conditions.length - 1].operator = cond.logical_operator;
              }
              nextOperator = cond.logical_operator;
            } else {
              conditions.push({
                vmType: cond.vm_type || '',
                query: cond.query || '',
                threshold: cond.value !== undefined ? String(cond.value) : '',
                operator: nextOperator,
                comparisonOperator: cond.operator === '<' ? '<' : '>',
                unit: cond.unit || 'Memory (GB)'
              });
              nextOperator = 'AND';
            }
          }
        }
        return {
          conditions,
          severity: rule.severity || 'Moderate',
          description: rule.description || '',
          useCustomQuery: false,
          customQueryText: ''
        };
      });
      setNodeRuleBook(nodeRuleBookEntries);

      // Extract and set VM types and node queries from all node rules
      const allVmTypes: string[] = [];
      const allNodeQueries: string[] = [];
      allNodeRuleObjs.forEach((rule: any) => {
        if (Array.isArray(rule.condition)) {
          rule.condition.forEach((cond: any) => {
            if (cond.vm_type && !allVmTypes.includes(cond.vm_type)) allVmTypes.push(cond.vm_type);
            if (cond.query && !allNodeQueries.includes(cond.query)) allNodeQueries.push(cond.query);
          });
        }
      });
      if (allVmTypes.length > 0) setSelectedVmTypes(allVmTypes);
      if (allNodeQueries.length > 0) setSelectedNodeQueries(allNodeQueries);

      // Extract and set namespaces, pods, and queries from all rules
      const allPods: string[] = [];
      const allNamespaces: string[] = [];
      const allQueries: string[] = [];
      allRuleObjs.forEach((rule: any) => {
        if (Array.isArray(rule.condition)) {
          rule.condition.forEach((cond: any) => {
            if (cond.pod_name && !allPods.includes(cond.pod_name)) allPods.push(cond.pod_name);
            if (cond.namespace && !allNamespaces.includes(cond.namespace)) allNamespaces.push(cond.namespace);
            if (cond.query && !allQueries.includes(cond.query)) allQueries.push(cond.query);
          });
        }
      });
      if (allPods.length > 0) setPods(allPods);
      if (allNamespaces.length > 0) setNamespaces(allNamespaces);
      if (allQueries.length > 0) setSelectedQuerys(allQueries);

      // Set alert destination if present
      if (config.alert_destination) {
        setAlertDestinationType(config.alert_destination.type || 'slack');
        setAlertDestinationValue(config.alert_destination.value || '');
      }
      // Optionally set testbed label, username, password, etc. if you want to display them
      // (not shown in UI currently)
    } catch (err) {
      alert('Invalid config file!');
    }
  };
  // Removed Rule Target select (entityType)

  // Load config using useConfigLoader hook
  const { loadConfig, loading: loadingConfig, error: loadConfigError } = useConfigLoader();

  const handleFetchConfig = async () => {
    const pc_ip = onboardingForm?.pcIp;
    if (!pc_ip) {
      alert('No PC IP specified in onboarding form.');
      return;
    }
    const config = await loadConfig(pc_ip);
    console.log('[DEBUG] handleFetchConfig loaded config:', JSON.stringify(config, null, 2));
    if (config && config.config) {
      handleConfigLoaded(config.config);
    } else if (config) {
      // fallback: try passing as-is (for legacy or direct format)
      handleConfigLoaded(config);
    }
  };
  const { onboardingForm } = useOnboarding();
  const navigate = useNavigate();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [pods, setPods] = useState<string[]>([]);
  const [groupedPodOptions, setGroupedPodOptions] = useState<any[]>([]);
  const [selectedQuerys, setSelectedQuerys] = useState<string[]>([]);
  const [onboarding, setOnboarding] = useState(false);

  const handleNext = () => {
    // Logic to go to the next step/page
    console.log("Next button clicked");
  };

  // Pod queries come from pod-queries.json (use all values in arrays)
  const filteredQueryOptions = React.useMemo(() => {
    if (Array.isArray(podQueriesRaw)) {
      return podQueriesRaw.map((query: string) => ({ value: query, label: query }));
    } else if (typeof podQueriesRaw === 'object' && podQueriesRaw !== null) {
      // Flatten all arrays in the object
      return Object.values(podQueriesRaw).flat().map((query: string) => ({ value: query, label: query }));
    }
    return [];
  }, [podQueriesRaw]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  // Alert destination state (must be inside component)
  const [alertDestinationType, setAlertDestinationType] = useState<'slack' | 'email'>('slack');
  const [alertDestinationValue, setAlertDestinationValue] = useState('');

  type RuleCondition = {
    pod: string;
    query: string;
    threshold: string;
    operator?: 'AND' | 'OR';
    comparisonOperator?: '>' | '<';
    unit?: 'Memory (GB)' | 'Time (ms)' | 'Percentage' | 'Count';
  };
  type RuleBookEntry = {
    conditions: RuleCondition[];
    severity: 'Low' | 'Moderate' | 'Critical';
    description?: string;
    overrideCondition?: string;
    useCustomQuery?: boolean;
    customQueryText?: string;
    collectLogs?: boolean;
    logDurationHours?: number;
  };
  const handleOverrideConditionChange = (ruleIdx: number, value: string) => {
    setRuleBook(prev => prev.map((rule, idx) => idx === ruleIdx ? { ...rule, overrideCondition: value } : rule));
  };
  const [ruleBook, setRuleBook] = useState<RuleBookEntry[]>([]);

  // Load initialConfig when provided (for editing existing rules)
  useEffect(() => {
    if (initialConfig) {
      console.log('[DEBUG] Loading initialConfig for editing:', initialConfig);
      try {
        handleConfigLoaded({ Config: initialConfig });
      } catch (error) {
        console.error('[ERROR] Failed to load initialConfig:', error);
      }
    }
  }, [initialConfig]);

  const handleRuleDescriptionChange = (ruleIdx: number, value: string) => {
    setRuleBook(prev => prev.map((rule, idx) => idx === ruleIdx ? { ...rule, description: value } : rule));
  };

  const handleAddRule = () => {
    // Use the first selected query for the new rule, if any
    const defaultQuery = selectedQuerys[0] || '';
    const defaultUnit = defaultQuery ? (queryToUnit[defaultQuery] || 'Memory (GB)') : 'Memory (GB)';
    setRuleBook(prev => [
      ...prev,
      {
        conditions: [
          { pod: pods[0] || '', query: defaultQuery, threshold: '', operator: 'AND', comparisonOperator: '>', unit: defaultUnit }
        ],
        severity: 'Moderate',
        useCustomQuery: false,
        customQueryText: '',
        collectLogs: true,
        logDurationHours: 1
      }
    ]);
  };

  // For per-condition pod select
  const handleRuleConditionPodChange = (ruleIdx: number, condIdx: number, pod: string) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => cidx === condIdx ? { ...cond, pod } : cond);
      return { ...rule, conditions: newConds };
    }));
  };

  // Unit automation based on query name
  // Heuristic: if query name includes 'cpu' => Percentage, 'memory' => Memory (GB) or Percentage, else fallback
  // For dropdown, allow both units for memory queries
  const queryToUnit: { [query: string]: RuleCondition['unit'] } = React.useMemo(() => {
    const mapping: { [query: string]: RuleCondition['unit'] } = {};
    Object.keys(metricAndThresholdData).forEach((query) => {
      const qLower = query.toLowerCase();
      let unit: RuleCondition['unit'] = 'Memory (GB)';
      if (qLower.includes('cpu')) unit = 'Percentage';
      else if (qLower.includes('memory')) unit = 'Memory (GB)';
      else if (qLower.includes('latency') || qLower.includes('time')) unit = 'Time (ms)';
      else if (qLower.includes('count') || qLower.includes('restarts') || qLower.includes('errors')) unit = 'Count';
      else if (qLower.includes('percent')) unit = 'Percentage';
      else if (qLower.includes('inode')) unit = 'Count';
      else if (qLower.includes('usage') && qLower.includes('disk')) unit = 'Percentage';
      // Add more heuristics as needed
      mapping[query] = unit;
    });
    return mapping;
  }, [metricAndThresholdData]);

  // NEW! Unit select restriction
  // For each query, determine allowed units for the dropdown
  const getAllowedUnits = (query: string): RuleCondition['unit'][] => {
    const qLower = query.toLowerCase();
    if (qLower.includes('memory')) {
      return ['Memory (GB)', 'Percentage'];
    }
    if (qLower.includes('cpu') || qLower.includes('percent')) {
      return ['Percentage'];
    }
    if (qLower.includes('latency') || qLower.includes('time')) {
      return ['Time (ms)'];
    }
    if (qLower.includes('count') || qLower.includes('restarts') || qLower.includes('errors') || qLower.includes('inode')) {
      return ['Count'];
    }
    if (qLower.includes('usage') && qLower.includes('disk')) {
      return ['Percentage'];
    }
    return ['Memory (GB)'];
  };

  const handleRuleConditionChange = (ruleIdx: number, condIdx: number, field: keyof RuleCondition, value: string) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => {
        if (cidx !== condIdx) return cond;
        // If the query is being changed, auto-set the unit
        if (field === 'query') {
          const autoUnit = queryToUnit[value] || cond.unit || 'Memory (GB)';
          return { ...cond, [field]: value, unit: autoUnit };
        }
        return { ...cond, [field]: value };
      });
      return { ...rule, conditions: newConds };
    }));
  };

  const handleAddCondition = (ruleIdx: number) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const prevOperator = rule.conditions.length > 0 ? rule.conditions[rule.conditions.length - 1].operator || 'AND' : 'AND';
      const defaultQuery = selectedQuerys[0] || '';
      const defaultUnit = defaultQuery ? (queryToUnit[defaultQuery] || 'Memory (GB)') : 'Memory (GB)';
      return {
        ...rule,
        conditions: [
          ...rule.conditions,
          { pod: pods[0] || '', query: defaultQuery, threshold: '', operator: prevOperator, comparisonOperator: '>', unit: defaultUnit }
        ]
      };
    }));
  };

  // Delete a condition from a rule
  const handleDeleteCondition = (ruleIdx: number, condIdx: number) => {
    setRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.filter((_, cidx) => cidx !== condIdx);
      // If only one condition left, keep at least one empty condition
      return {
        ...rule,
        conditions: newConds.length > 0 ? newConds : [{ pod: pods[0] || '', query: selectedQuerys[0] || '', threshold: '', operator: 'AND', comparisonOperator: '>', unit: 'Memory (GB)' }]
      };
    }));
  };

  // Delete a rule from the rule book
  const handleDeleteRule = (ruleIdx: number) => {
    setRuleBook(prev => prev.filter((_, idx) => idx !== ruleIdx));
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    marginTop: 4,
    backgroundColor: '#fff',
    color: '#000'
  };
  const customSelectStyles = {
    option: (provided: any, state: any) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? '#0078d4'
        : state.isFocused
          ? '#e6f0fa'
          : '#fff',
      color: state.isSelected ? '#fff' : '#333',
      fontWeight: state.isSelected ? 600 : 400,
      padding: 10,
    }),
    multiValue: (provided: any) => ({
      ...provided,
      backgroundColor: '#0078d4',
      color: '#fff',
    }),
    multiValueLabel: (provided: any) => ({
      ...provided,
      color: '#fff',
    }),
    multiValueRemove: (provided: any) => ({
      ...provided,
      color: '#fff',
      ':hover': {
        backgroundColor: '#005a9e',
        color: '#fff',
      },
    }),
  };
  const podSelectStyles = {
    ...customSelectStyles,
    option: (provided: any, state: any) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? '#0078d4'
        : state.isFocused
          ? '#e6f0fa'
          : '#fff',
      color: state.isSelected ? '#fff' : '#333',
      fontWeight: state.isSelected ? 600 : 400,
      padding: '10px 10px 10px 32px',
    }),
  };
  const handleQuerySelect = (selectedOptions: any) => {
    const querys: string[] = selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [];
    setSelectedQuerys(querys);
  };



  useEffect(() => {
    if (namespaces.length === 0) {
      setGroupedPodOptions([]);
      setPods([]);
      return;
    }
    const groups = namespaces.map(ns => ({
      label: ns,
      options: (nameAndPodData[ns] || []).map(pod => ({ value: pod, label: pod }))
    }));
    const allPods = groups.flatMap(g => g.options.map(opt => opt.value));
    setGroupedPodOptions(groups);
    setPods(prev => prev.filter(pod => allPods.includes(pod)));
  }, [namespaces]);

  // Rules Saved to Json, and sent to backend using run_backend.py
  const handleSave = async () => {
    setDuplicateError(null);
  
    // 1. Check duplicate Pod rules
    const podDupes = checkForDuplicateRules(ruleBook, normalizePodRule);
    if (podDupes.duplicates) {
      setDuplicateError(
        `Duplicate Pod Rule(s) detected at indices: ${podDupes.indices
          .map((i) => i + 1)
          .join(", ")}. Please remove or edit duplicates before submitting.`
      );
      return;
    }
  
    // 2. Check duplicate Node rules
    const nodeDupes = checkForDuplicateRules(nodeRuleBook, normalizeNodeRule);
    if (nodeDupes.duplicates) {
      setDuplicateError(
        `Duplicate Node Rule(s) detected at indices: ${nodeDupes.indices
          .map((i) => i + 1)
          .join(", ")}. Please remove or edit duplicates before submitting.`
      );
      return;
    }
  
    // 3. Build base config
    let config: any = {};
    if (isSimpleMode && testbedContext?.testbed) {
      // Simple mode: Use testbed details from context
      const testbed = testbedContext.testbed;
      config = {
        pc_ip: testbed.pc_ip || testbed.testbed_json?.pc_ip,
        username: testbed.username || testbed.testbed_json?.username,
        password: testbed.password || testbed.testbed_json?.password,
        testbed_label: testbed.testbed_label,
        alert_destination: {
          type: alertDestinationType,
          value: alertDestinationValue,
        },
      };
    } else if (onboardingForm) {
      // Legacy onboarding flow
      config = {
        pc_ip: onboardingForm.pcIp,
        username: onboardingForm.username,
        password: onboardingForm.password,
        testbed_label: onboardingForm.ncmLabel || pods[0] || "",
        alert_destination: {
          type: alertDestinationType,
          value: alertDestinationValue,
        },
      };
    }
  
    // 4. Build Pod + Node rules
    const podRules: any = {};
    ruleBook.forEach((rule, idx) => {
      let ruleObj: any = {
        severity: rule.severity,
        description: rule.description || "",
        override_condition: rule.overrideCondition || "",
      };
      if (rule.collectLogs !== false) {
        ruleObj.collect_logs = "True";
        ruleObj.log_duration_hours = rule.logDurationHours || 1;
      } else {
        ruleObj.collect_logs = "False";
        ruleObj.log_duration_hours = 0;
      }
      if (rule.useCustomQuery && rule.customQueryText) {
        ruleObj.condition = [{ expr: rule.customQueryText }];
      } else {
        const conditionArr: any[] = [];
        rule.conditions.forEach((cond, idx) => {
          let foundNamespace = "";
          for (const ns of namespaces) {
            if ((nameAndPodData[ns] || []).includes(cond.pod)) {
              foundNamespace = ns;
              break;
            }
          }
          conditionArr.push({
            namespace: foundNamespace || namespaces[0] || "",
            pod_name: cond.pod,
            query: cond.query,
            operator: cond.comparisonOperator || ">",
            value: cond.threshold,
            unit: cond.unit || "Memory (GB)",
          });
          if (idx < rule.conditions.length - 1) {
            conditionArr.push({ logical_operator: cond.operator || "AND" });
          }
        });
        ruleObj.condition = conditionArr;
      }
      podRules[`rule${idx + 1}`] = ruleObj;
    });
  
    const nodeRules: any = {};
    nodeRuleBook.forEach((rule, idx) => {
      let ruleObj: any = {
        severity: rule.severity,
        description: rule.description || "",
      };
      if (rule.collectLogs !== false) {
        ruleObj.collect_logs = "True";
        ruleObj.log_duration_hours = rule.logDurationHours || 1;
      } else {
        ruleObj.collect_logs = "False";
        ruleObj.log_duration_hours = 0;
      }
      if (rule.useCustomQuery && rule.customQueryText) {
        ruleObj.condition = [{ expr: rule.customQueryText }];
      } else {
        const conditionArr: any[] = [];
        rule.conditions.forEach((cond, idx) => {
          conditionArr.push({
            vm_type: cond.vmType,
            query: cond.query,
            operator: cond.comparisonOperator || ">",
            value: cond.threshold,
            unit: cond.unit || "Memory (GB)",
          });
          if (idx < rule.conditions.length - 1) {
            conditionArr.push({ logical_operator: cond.operator || "AND" });
          }
        });
        ruleObj.condition = conditionArr;
      }
      nodeRules[`rule${idx + 1}`] = ruleObj;
    });
  
    // 5. Final JSON
    const configJson = {
      Config: {
        ...config,
        Rules: {
          "Pod Rules": podRules,
          "Node Rules": nodeRules,
        },
      },
    };
  
    // Simple mode: Just call onSave callback and return
    if (isSimpleMode) {
      console.log('[DEBUG] Simple mode: Calling onSave with config');
      onSave(configJson.Config);
      return;
    }

    // Legacy flow: save locally
  const blob = new Blob([JSON.stringify(configJson, null, 2)], {
    type: "application/json",
  });
  saveAs(blob, "nmt_config.json");
  
  // Always: upload-rule-config
  try {
    const unique_testbed_id = testbedContext?.unique_testbed_id || localStorage.getItem("unique_testbed_id");
    const pc_ip = configJson?.Config?.pc_ip;

    // Allow if either testbed UUID exists OR pc_ip is present (direct onboarding)
    if (!unique_testbed_id && !pc_ip) {
      alert("Missing testbed UUID or PC IP – either upload a testbed first or provide PC IP in config!");
      return;
    }
    // Always use localhost:5000 for backend in development
    const backendUrl = 'http://localhost:5000';
    const ruleUploadResponse = await fetch(
      `${backendUrl}/api/upload-rule-config`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unique_testbed_id: unique_testbed_id || null,  // Pass null if not available
        pc_ip: pc_ip || null,  // Pass pc_ip for direct onboarding
        config: configJson,
        timestamp: new Date().toISOString(),
      }),
    }
  );
    if (ruleUploadResponse.ok) {
      const ruleUploadResult = await ruleUploadResponse.json();
      console.log("Rule config saved successfully:", ruleUploadResult.filename);
    } else {
      console.error("Failed to save rule config to submitted-rules folder");
    }
  } catch (error) {
    console.error("Error saving rule config to submitted-rules folder:", error);
  }
  
  // Only if onboardingForm exists: deploy-config-immediate
  if (onboardingForm) {
    try {
      const unique_testbed_id = localStorage.getItem("unique_testbed_id");
      const pc_ip = configJson?.Config?.pc_ip;

      // Allow if either testbed UUID exists OR pc_ip is present (direct onboarding)
      if (!unique_testbed_id && !pc_ip) {
        alert("Missing testbed UUID or PC IP – either upload a testbed first or provide PC IP in config!");
        return;
      }
      console.log("Immediately deploying config to remote server...");
      const backendUrl2 = 'http://localhost:5000';
      const deployResponse = await fetch(
        `${backendUrl2}/api/deploy-config-immediate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unique_testbed_id: unique_testbed_id || null,
            pc_ip: pc_ip || null,  // Pass pc_ip for direct onboarding
            config: configJson,
            timestamp: new Date().toISOString(),
          }),
        }
      );
    
      const deployResult = await deployResponse.json();
      if (deployResult.success) {
        console.log("Config deployed immediately:", deployResult.message);
        console.log("Remote output:", deployResult.stdout);
        setShowSuccess(true);
      } else {
        console.error("Failed to deploy config immediately:", deployResult.error);
      }
    } catch (error) {
      console.error("Error in immediate deployment:", error);
    }
  }
  
  // Always: save-config (DB)
  try {
    const unique_testbed_id = localStorage.getItem("unique_testbed_id");
    const pc_ip = configJson?.Config?.pc_ip;
  
    // Allow if either testbed UUID exists OR pc_ip is present (direct onboarding)
    if (!unique_testbed_id && !pc_ip) {
      alert("Missing testbed UUID or PC IP – either upload a testbed first or provide PC IP in config!");
      return;
    }
  
    const savePayload = {
      unique_testbed_id: unique_testbed_id || null, // Pass null if not available
      pc_ip: pc_ip || null,  // Pass pc_ip for direct onboarding
      config: configJson,
      timestamp: new Date().toISOString(),
    };
  
    const backendUrl3 = 'http://localhost:5000';
    const res = await fetch(
      `${backendUrl3}/api/save-config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload),
      }
    );
  
    if (res.ok) {
      const result = await res.json();
      console.log("Config saved to database for future retrieval.");
  
      // ✅ Store unique_rule_id in localStorage
      localStorage.setItem('unique_rule_id', result.unique_rule_id);
      
      setShowSuccess(true);
    } else {
      console.error("Failed to save config to DB");
    }
  } catch (error) {
    console.error("Error saving config to database:", error);
  }
};

    // setTimeout(() => setShowSuccess(false), 2000);
  
  // Node section state
  const [showNodeSection, setShowNodeSection] = useState(false);

  // Custom script upload state
  const [useCustomScript, setUseCustomScript] = useState(false);
  const [uploadedScript, setUploadedScript] = useState<any>(null);

  // VM Type select state (now sourced from vm-types.json)
  const vmTypeOptions = Object.keys(vmTypesDataRaw).map(type => ({ value: type, label: type }));
  const [selectedVmTypes, setSelectedVmTypes] = useState<string[]>([]);

  // Node queries come from node-queries.json (use all values in arrays)
  const nodeQueryOptions = React.useMemo(() => {
    if (Array.isArray(nodeQueriesRaw)) {
      return nodeQueriesRaw.map((query: string) => ({ value: query, label: query }));
    } else if (typeof nodeQueriesRaw === 'object' && nodeQueriesRaw !== null) {
      // Flatten all arrays in the object
      return Object.values(nodeQueriesRaw).flat().map((query: string) => ({ value: query, label: query }));
    }
    return [];
  }, [nodeQueriesRaw]);
  const [selectedNodeQueries, setSelectedNodeQueries] = useState<string[]>([]);

  // Node Rule Book state
  type NodeRuleCondition = {
    vmType: string;
    query: string;
    threshold: string;
    operator?: 'AND' | 'OR';
    comparisonOperator?: '>' | '<';
    unit?: 'Memory (GB)' | 'Time (ms)' | 'Percentage' | 'Count';
  };
  type NodeRuleBookEntry = {
    conditions: NodeRuleCondition[];
    severity: 'Low' | 'Moderate' | 'Critical';
    description?: string;
    useCustomQuery?: boolean;
    customQueryText?: string;
    collectLogs?: boolean;
    logDurationHours?: number;
  };
  const [nodeRuleBook, setNodeRuleBook] = useState<NodeRuleBookEntry[]>([]);

  // Add Node Rule
  const handleAddNodeRule = () => {
    const defaultQuery = selectedNodeQueries[0] || '';
    const defaultUnit = defaultQuery ? (queryToUnit[defaultQuery] || 'Memory (GB)') : 'Memory (GB)';
    setNodeRuleBook(prev => [
      ...prev,
      {
        conditions: [
          { vmType: selectedVmTypes[0] || '', query: defaultQuery, threshold: '', operator: 'AND', comparisonOperator: '>', unit: defaultUnit }
        ],
        severity: 'Moderate',
        useCustomQuery: false,
        customQueryText: '',
        collectLogs: true,
        logDurationHours: 1
      }
    ]);
  };
  // Node Rule Condition change
  const handleNodeRuleConditionChange = (ruleIdx: number, condIdx: number, field: keyof NodeRuleCondition, value: string) => {
    setNodeRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => {
        if (cidx !== condIdx) return cond;
        if (field === 'query') {
          const autoUnit = queryToUnit[value] || cond.unit || 'Memory (GB)';
          return { ...cond, [field]: value, unit: autoUnit };
        }
        return { ...cond, [field]: value };
      });
      return { ...rule, conditions: newConds };
    }));
  };
  // Node Rule Condition VM Type change
  const handleNodeRuleConditionVmTypeChange = (ruleIdx: number, condIdx: number, vmType: string) => {
    setNodeRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.map((cond, cidx) => cidx === condIdx ? { ...cond, vmType } : cond);
      return { ...rule, conditions: newConds };
    }));
  };
  // Add Node Condition
  const handleAddNodeCondition = (ruleIdx: number) => {
    setNodeRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const prevOperator = rule.conditions.length > 0 ? rule.conditions[rule.conditions.length - 1].operator || 'AND' : 'AND';
      const defaultQuery = selectedNodeQueries[0] || '';
      const defaultUnit = defaultQuery ? (queryToUnit[defaultQuery] || 'Memory (GB)') : 'Memory (GB)';
      return {
        ...rule,
        conditions: [
          ...rule.conditions,
          { vmType: selectedVmTypes[0] || '', query: defaultQuery, threshold: '', operator: prevOperator, comparisonOperator: '>', unit: defaultUnit }
        ]
      };
    }));
  };
  // Delete Node Condition
  const handleDeleteNodeCondition = (ruleIdx: number, condIdx: number) => {
    setNodeRuleBook(prev => prev.map((rule, idx) => {
      if (idx !== ruleIdx) return rule;
      const newConds = rule.conditions.filter((_, cidx) => cidx !== condIdx);
      return {
        ...rule,
        conditions: newConds.length > 0 ? newConds : [{ vmType: selectedVmTypes[0] || '', query: selectedNodeQueries[0] || '', threshold: '', operator: 'AND', comparisonOperator: '>', unit: 'Memory (GB)' }]
      };
    }));
  };
  // Delete Node Rule
  const handleDeleteNodeRule = (ruleIdx: number) => {
    setNodeRuleBook(prev => prev.filter((_, idx) => idx !== ruleIdx));
  };

  // Custom script handlers
  const handleCustomScriptUpload = (scriptData: any) => {
    setUploadedScript(scriptData);
    // When custom script is uploaded, reset rule books to custom query mode
    setRuleBook([]);
    setNodeRuleBook([]);
  };

  const handleToggleCustomScript = () => {
    setUseCustomScript(prev => {
      const newValue = !prev;
      if (!newValue) {
        // Reset when disabling custom script mode
        setUploadedScript(null);
      }
      return newValue;
    });
  };

  

{/* =============== PAGE ELEMENTS =============== */}

  return (
    <div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item active">Rule Builder</li>
          </ol>
        </nav>
      </div>

      <div style={{
        maxWidth: 1400,
        margin: '0 auto',
      }}>
      <div className="card rounded-4 border-0 shadow-sm" style={{
        padding: 40,
        overflow: 'hidden'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 90,
            height: 90,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
          }}>
            <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 55, height: 55, objectFit: 'contain' }} />
          </div>
          <h2 style={{ color: '#00008B', marginTop: 0, marginBottom: 10, fontWeight: 700, letterSpacing: '-0.5px', fontSize: 32 }}>Rule Builder</h2>
          <p className="text-muted mb-0" style={{ fontSize: 16 }}>Create and manage monitoring rules for your testbeds</p>
        </div>

        {/* Top Action Buttons Menu */}
        {/* Hide complex options in simple mode */}
        {!isSimpleMode && (
          <nav
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0,
              marginBottom: 32,
              background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
              borderRadius: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              border: '1px solid #dee2e6',
              padding: '0 12px',
              minHeight: 60,
              justifyContent: 'space-evenly'
            }}
            aria-label="Main actions menu"
          >
            <button
              type="button"
              onClick={() => setShowNodeSection(v => !v)}
              style={{
                background: showNodeSection ? '#0078d4' : 'transparent',
                color: showNodeSection ? '#fff' : '#0078d4',
                border: 'none',
                borderRadius: '8px 0 0 8px',
                padding: '0 45px',
                height: 54,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
                transition: 'background 0.2s',
                outline: 'none',
                borderRight: '1px solid #e0e6ef'
              }}
            >
              Activate Node Rules
            </button>
            <CustomScriptNavButton
              isActive={useCustomScript}
              onToggle={handleToggleCustomScript}
            />
            <div style={{ display: 'flex', alignItems: 'center', height: 54, padding: '0 50px 0 20px', background: 'transparent', borderRight: '1px solid #e0e6ef' }}>
              <ConfigUploader onConfigLoaded={handleConfigLoaded} />
            </div>
            <button
              type="button"
              onClick={handleFetchConfig}
              disabled={loadingConfig}
              style={{
                background: 'transparent',
                color: '#0078d4',
                border: 'none',
                borderRadius: '0 8px 8px 0',
                padding: '0 20px',
                height: 54,
                fontWeight: 600,
                cursor: loadingConfig ? 'not-allowed' : 'pointer',
                fontSize: 13,
                outline: 'none',
              }}
            >
              {loadingConfig ? 'Loading Config...' : 'Load Current Config'}
            </button>
          </nav>
        )}
        {!isSimpleMode && loadConfigError && (
          <div style={{ color: 'red', marginBottom: 8 }}>{loadConfigError}</div>
        )}

        {/* Custom Script Upload Section - Hidden in simple mode */}
        {!isSimpleMode && (
          <CustomScriptUploader
            isActive={useCustomScript}
            onScriptUploaded={handleCustomScriptUpload}
          />
        )}

        {/* Manual Configuration Sections - Hidden when using custom script */}
        {!useCustomScript && (
          <>
            {/* Namespace select */}
        <div>
          {/* <h4 style={{ marginBottom: 8, color: '#444' }}>Namespaces</h4>  */}

          {/* Select all button start */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: '#444' }}>Namespaces</h4>
            <button
              type="button"
              onClick={() => setNamespaces(Object.keys(nameAndPodData))}
              style={{
                background: '#0078d4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Select All
            </button>
          </div>
          {/* Select all button end */}

          <Select
            options={namespaceOptions}
            value={namespaceOptions.filter(opt => namespaces.includes(opt.value))}
            onChange={(selectedOptions) =>
              setNamespaces(selectedOptions ? selectedOptions.map(opt => opt.value) : [])
            }
            placeholder="Select Namespaces"
            isMulti
            isClearable
            styles={customSelectStyles}
            closeMenuOnSelect={false}
          />
        </div>

        {/* Pod select (grouped by namespace) */}
        <div>
          {/* <h4 style={{ marginBottom: 8, color: '#444' }}>Pod Names</h4> */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: '#444' }}>Pod Names</h4>
            <button
              type="button"
              onClick={() => {
                const allPods = groupedPodOptions.flatMap(group => group.options.map((opt: any) => opt.value));
                setPods(allPods);
              }}
              style={{
                background: '#0078d4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Select All
            </button>
          </div>
          <Select
            options={groupedPodOptions}
            value={(() => {
              const selected: any[] = [];
              groupedPodOptions.forEach((group: any) => {
                group.options.forEach((opt: any) => {
                  if (pods.includes(opt.value)) selected.push(opt);
                });
              });
              return selected;
            })()}
            onChange={(selectedOptions: any) =>
              setPods(selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [])
            }
            placeholder="Select Pods"
            isMulti
            isClearable
            styles={podSelectStyles}
            closeMenuOnSelect={false}
          />
        </div>

        {/* Querys selection and thresholds */}
        <div>
          <h4 style={{ marginBottom: 8, color: '#444' }}>Queries</h4>
          <Select
            options={filteredQueryOptions}
            value={filteredQueryOptions.filter(opt => selectedQuerys.includes(opt.value))}
            onChange={handleQuerySelect}
            placeholder={'Select Queries'}
            isMulti
            isClearable
            styles={customSelectStyles}
            closeMenuOnSelect={false}
          />
        </div>
        </>
        )}

        {/* Rule Book Section or Custom Rule Builder */}
        {useCustomScript ? (
          <CustomRuleBuilder
            ruleBook={ruleBook}
            setRuleBook={setRuleBook}
            nodeRuleBook={nodeRuleBook}
            setNodeRuleBook={setNodeRuleBook}
            handleDeleteRule={handleDeleteRule}
            handleDeleteNodeRule={handleDeleteNodeRule}
          />
        ) : (
          <>
            {/* Rule Book Section */}
        <div style={{ marginTop: 32, padding: 24, border: '1px solid #dee2e6', borderRadius: 12, background: 'linear-gradient(135deg, #f8fafd 0%, #ffffff 100%)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <h3 style={{ color: '#000', marginBottom: 20, fontWeight: 700, fontSize: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="material-icons-outlined" style={{ fontSize: 26, color: '#0078d4' }}>menu_book</i>
            Rule Book
          </h3>
          {ruleBook.map((rule, ruleIdx) => (
            <div key={ruleIdx} style={{ marginBottom: 24, padding: 20, border: '1px solid #dee2e6', borderRadius: 10, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              {/* Collect Logs toggle */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#0078d4', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rule.collectLogs !== false}
                    onChange={e => setRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, collectLogs: e.target.checked } : r))}
                    style={{ marginRight: 4 }}
                  />
                  Collect Logs
                </label>
                <select
                  value={rule.logDurationHours || 1}
                  onChange={e => setRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, logDurationHours: Number(e.target.value) } : r))}
                  style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid #0078d4', fontWeight: 500, color: '#0078d4', fontSize: 13, background: '#fff' }}
                >
                  {[1,2,4,8,12,24,48,72].map(h => (
                    <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                  ))}
                </select>
                <span style={{ marginLeft: 4, color: '#555', fontSize: 13 }}>Log Duration</span>
              </div>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#000' }}>Rule-{ruleIdx + 1}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#000' }}>Severity:</span>
                  <select
                    value={rule.severity}
                    onChange={e => setRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, severity: e.target.value as 'Low' | 'Moderate' | 'Critical' } : r))}
                    style={{ ...inputStyle, width: 140, color: '#000', marginLeft: 4 }}
                  >
                    <option value="Low">Low</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Critical">Critical</option>
                  </select>
                  {/* Custom Query Toggle */}
                  <label style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500, color: '#0078d4', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!rule.useCustomQuery}
                      onChange={e => setRuleBook(prev => prev.map((r, idx) => {
                        if (idx !== ruleIdx) return r;
                        if (e.target.checked) {
                          // Custom Query selected: Collect Logs False
                          return { ...r, useCustomQuery: true, customQueryText: '', collectLogs: false };
                        } else {
                          // Custom Query unselected: keep collectLogs as is
                          return { ...r, useCustomQuery: false, customQueryText: '' };
                        }
                      }))}
                      style={{ marginRight: 4 }}
                    />
                    Custom Query
                  </label>
                  {/* Delete Rule Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(ruleIdx)}
                    style={{
                      background: '#ff4d4f',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      padding: '2px 10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 14,
                      marginLeft: 12
                    }}
                    title="Delete Rule"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* Rule Description input */}
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  value={rule.description || ''}
                  onChange={e => handleRuleDescriptionChange(ruleIdx, e.target.value)}
                  placeholder="Enter rule description..."
                  style={{ ...inputStyle, width: '95%', fontSize: 15, marginTop: 0, marginBottom: 0, background: '#f8fafd', border: '1px solid #ccc' }}
                />
              </div>
              {/* Custom Query input */}
              {rule.useCustomQuery && (
                <div style={{ marginBottom: 12 }}>
                  <input
                    type="text"
                    value={rule.customQueryText || ''}
                    onChange={e => setRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, customQueryText: e.target.value } : r))}
                    placeholder="Enter your custom query here..."
                    style={{ ...inputStyle, width: '98%', fontSize: 15, marginTop: 0, marginBottom: 0, background: '#fffbe6', border: '1px solid #ffe58f', color: '#ad6800' }}
                  />
                  <div style={{ fontSize: 12, color: '#ad6800', marginTop: 2, marginLeft: 2 }}>
                    This custom query will override the selected queries for this rule.
                  </div>
                </div>
              )}
              {/* Optional Override Condition input */}
              {/* <div style={{ marginBottom: 10 }}>
                <input
                  type="text"
                  value={rule.overrideCondition || ''}
                  onChange={e => handleOverrideConditionChange(ruleIdx, e.target.value)}
                  placeholder="*Override Condition (optional)"
                  style={{ ...inputStyle, width: '95%', fontSize: 14, marginTop: 0, marginBottom: 0, background: '#f4f4f4', border: '1px solid #bbb', fontStyle: 'italic' }}
                />
              </div> */}
              {/* Pod select is now per condition, not per rule */}
              {!rule.useCustomQuery && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                  <thead>
                    <tr style={{ background: '#f0f4fa' }}>
                      <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Pod Name</th>
                      <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Query Name</th>
                      <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Operator</th>
                      <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Threshold Value</th>
                      <th style={{ border: '1px solid #ddd', padding: 2, fontWeight: 600, color: '#333', width: 50, minWidth: 50, maxWidth: 50 }}>Unit</th>
                      <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Logical Operator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.conditions.map((cond, condIdx) => (
                      <tr key={condIdx}>
                        {/* Pod Name */}
                        <td style={{ border: '1px solid #ddd', padding: 4 }}>
                          <select
                            value={cond.pod}
                            onChange={e => handleRuleConditionPodChange(ruleIdx, condIdx, e.target.value)}
                            style={{ ...inputStyle, width: 120, color: '#000', margin: 0 }}
                          >
                            {pods.map(pod => (
                              <option key={pod} value={pod}>{pod}</option>
                            ))}
                          </select>
                        </td>
                        {/* Query Name */}
                        <td style={{ border: '1px solid #ddd', padding: 4 }}>
                          <select
                            value={cond.query}
                            onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'query', e.target.value)}
                            style={{ ...inputStyle, width: 140, color: '#000', margin: 0 }}
                          >
                            {selectedQuerys.map(query => (
                              <option key={query} value={query}>{query}</option>
                            ))}
                          </select>
                        </td>
                        {/* Operator */}
                        <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center' }}>
                          <select
                            value={cond.comparisonOperator || '>'}
                            onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'comparisonOperator', e.target.value as '>' | '<')}
                            style={{ ...inputStyle, width: 60, color: '#000', margin: 0 }}
                          >
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                          </select>
                        </td>
                        {/* Threshold Value */}
                        <td style={{ border: '1px solid #ddd', padding: 4 }}>
                          <input
                            type="text"
                            value={cond.threshold}
                            onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'threshold', e.target.value)}
                            style={{ ...inputStyle, width: 90, color: '#000', margin: 0 }}
                          />
                        </td>
                        {/* Unit */}
                        <td style={{ border: '1px solid #ddd', padding: 2, textAlign: 'center', color: '#555', position: 'relative', width: 50, minWidth: 50, maxWidth: 50 }}>
                          <span style={{ position: 'absolute', left: 4, top: 8, fontWeight: 500, color: '#0078d4', fontSize: 13 }}>
                            {cond.unit === 'Time (ms)'
                              ? 'ms'
                              : cond.unit === 'Memory (GB)'
                                ? 'GB'
                                : cond.unit === 'Percentage'
                                  ? '%'
                                  : cond.unit === 'Count'
                                    ? '#'
                                    : 'GB'}
                          </span>
                          <select
                            value={cond.unit || 'Memory (GB)'}
                            onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'unit', e.target.value as 'Memory (GB)' | 'Time (ms)' | 'Percentage' | 'Count')}
                            style={{ ...inputStyle, width: 50, minWidth: 50, maxWidth: 50, color: 'transparent', margin: 0, position: 'relative', zIndex: 1, background: 'transparent', fontSize: 13, paddingLeft: 18 }}
                          >
                            {getAllowedUnits(cond.query).map(unitOpt => (
                              <option key={unitOpt} value={unitOpt}>{unitOpt}</option>
                            ))}
                          </select>
                        </td>
                        {/* Logical Operator and Delete Button */}
                        <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                          {condIdx < rule.conditions.length - 1 ? (
                            <select
                              value={cond.operator}
                              onChange={e => handleRuleConditionChange(ruleIdx, condIdx, 'operator', e.target.value as 'AND' | 'OR')}
                              style={{ ...inputStyle, width: 85, color: '#000', margin: 0 }}
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          ) : ''}
                          {/* Delete Condition Button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteCondition(ruleIdx, condIdx)}
                            style={{
                              background: '#ff4d4f',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              fontSize: 13,
                              marginLeft: 4
                            }}
                            title="Delete Condition"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button type="button" onClick={() => handleAddCondition(ruleIdx)} style={{ marginTop: 6, background: '#e6f0fa', color: '#0078d4', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 500, cursor: 'pointer' }}>
                + Add Condition
              </button>
            </div>
          ))}
          <button type="button" onClick={handleAddRule} className="btn btn-primary" style={{ borderRadius: 8, padding: '12px 24px', fontWeight: 600, fontSize: 15, boxShadow: '0 2px 8px rgba(0,120,212,0.25)' }}>
            <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>add</i>
            Add Rule
          </button>
        </div>
        </>
        )}

        {/* Node Section (appears below RuleBook) */}
        {showNodeSection && !useCustomScript && (
          <div style={{ marginTop: 32, background: '#fff', border: '1px solid #dee2e6', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <h3 style={{ color: '#000', marginBottom: 20, fontWeight: 700, fontSize: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="material-icons-outlined" style={{ fontSize: 26, color: '#0078d4' }}>storage</i>
              Node Rule Builder
            </h3>
            {/* VM Type select */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h4 style={{ margin: 0, color: '#444' }}>VM Types</h4>
                <button
                  type="button"
                  onClick={() => setSelectedVmTypes(vmTypeOptions.map(opt => opt.value))}
                  style={{
                    background: '#0078d4',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Select All
                </button>
              </div>
              <Select
                options={vmTypeOptions}
                value={vmTypeOptions.filter(opt => selectedVmTypes.includes(opt.value))}
                onChange={(selectedOptions) =>
                  setSelectedVmTypes(selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [])
                }
                placeholder="Select VM Types"
                isMulti
                isClearable
                styles={customSelectStyles}
                closeMenuOnSelect={false}
              />
            </div>
            {/* Node Queries select */}
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ marginBottom: 8, color: '#444' }}>Queries</h4>
              <Select
                options={nodeQueryOptions}
                value={nodeQueryOptions.filter(opt => selectedNodeQueries.includes(opt.value))}
                onChange={(selectedOptions) =>
                  setSelectedNodeQueries(selectedOptions ? selectedOptions.map((opt: any) => opt.value) : [])
                }
                placeholder="Select Node Queries"
                isMulti
                isClearable
                styles={customSelectStyles}
                closeMenuOnSelect={false}
              />
            </div>
            {/* Node Rule Book Section */}
            <div style={{ marginTop: 24, padding: 24, border: '1px solid #dee2e6', borderRadius: 10, background: 'linear-gradient(135deg, #f8fafd 0%, #ffffff 100%)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <h3 style={{ color: '#000', marginBottom: 20, fontWeight: 700, fontSize: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="material-icons-outlined" style={{ fontSize: 24, color: '#0078d4' }}>menu_book</i>
                Node Rule Book
              </h3>
              {nodeRuleBook.map((rule, ruleIdx) => (
                <div key={ruleIdx} style={{ marginBottom: 24, padding: 20, border: '1px solid #dee2e6', borderRadius: 10, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  {/* Collect Logs toggle for Node Rule */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#0078d4', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rule.collectLogs !== false}
                        onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, collectLogs: e.target.checked } : r))}
                        style={{ marginRight: 4 }}
                      />
                      Collect Logs
                    </label>
                    <select
                      value={rule.logDurationHours || 1}
                      onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, logDurationHours: Number(e.target.value) } : r))}
                      style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid #0078d4', fontWeight: 500, color: '#0078d4', fontSize: 13, background: '#fff' }}
                    >
                      {[1,2,4,8,12,24,48,72].map(h => (
                        <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                      ))}
                    </select>
                    <span style={{ marginLeft: 4, color: '#555', fontSize: 13 }}>Log Duration</span>
                  </div>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ color: '#000' }}>Node Rule-{ruleIdx + 1}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#000' }}>Severity:</span>
                      <select
                        value={rule.severity}
                        onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, severity: e.target.value as 'Low' | 'Moderate' | 'Critical' } : r))}
                        style={{ ...inputStyle, width: 140, color: '#000', marginLeft: 4 }}
                      >
                        <option value="Low">Low</option>
                        <option value="Moderate">Moderate</option>
                        <option value="Critical">Critical</option>
                      </select>
                      {/* Custom Query Toggle */}
                      <label style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500, color: '#0078d4', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!rule.useCustomQuery}
                          onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => {
                            if (idx !== ruleIdx) return r;
                            if (e.target.checked) {
                              // Custom Query selected: Pod Logs False, System Logs True
                              return { ...r, useCustomQuery: true, customQueryText: '', collectLogs: false };
                            } else {
                              // Custom Query unselected: keep collectLogs as is
                              return { ...r, useCustomQuery: false, customQueryText: '' };
                            }
                          }))}
                          style={{ marginRight: 4 }}
                        />
                        Custom Query
                      </label>
                      {/* Delete Node Rule Button */}
                      <button
                        type="button"
                        onClick={() => handleDeleteNodeRule(ruleIdx)}
                        style={{
                          background: '#ff4d4f',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '2px 10px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: 14,
                          marginLeft: 12
                        }}
                        title="Delete Node Rule"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* Node Rule Description input */}
                  <div style={{ marginBottom: 8 }}>
                    <input
                      type="text"
                      value={rule.description || ''}
                      onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, description: e.target.value } : r))}
                      placeholder="Enter node rule description..."
                      style={{ ...inputStyle, width: '95%', fontSize: 15, marginTop: 0, marginBottom: 0, background: '#f8fafd', border: '1px solid #ccc' }}
                    />
                  </div>
                  {/* Custom Query input */}
                  {rule.useCustomQuery && (
                    <div style={{ marginBottom: 12 }}>
                      <input
                        type="text"
                        value={rule.customQueryText || ''}
                        onChange={e => setNodeRuleBook(prev => prev.map((r, idx) => idx === ruleIdx ? { ...r, customQueryText: e.target.value } : r))}
                        placeholder="Enter your custom node query here..."
                        style={{ ...inputStyle, width: '98%', fontSize: 15, marginTop: 0, marginBottom: 0, background: '#fffbe6', border: '1px solid #ffe58f', color: '#ad6800' }}
                      />
                      <div style={{ fontSize: 12, color: '#ad6800', marginTop: 2, marginLeft: 2 }}>
                        This custom query will override the selected queries for this node rule.
                      </div>
                    </div>
                  )}
                  {/* Node Rule Table */}
                  {!rule.useCustomQuery && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                      <thead>
                        <tr style={{ background: '#f0f4fa' }}>
                          <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>VM Type</th>
                          <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Query Name</th>
                          <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Operator</th>
                          <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Threshold Value</th>
                          <th style={{ border: '1px solid #ddd', padding: 2, fontWeight: 600, color: '#333', width: 50, minWidth: 50, maxWidth: 50 }}>Unit</th>
                          <th style={{ border: '1px solid #ddd', padding: 6, fontWeight: 600, color: '#333' }}>Logical Operator</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rule.conditions.map((cond, condIdx) => {
                          return (
                            <tr key={condIdx}>
                              {/* VM Type */}
                              <td style={{ border: '1px solid #ddd', padding: 4 }}>
                                <select
                                  value={cond.vmType}
                                  onChange={e => handleNodeRuleConditionVmTypeChange(ruleIdx, condIdx, e.target.value)}
                                  style={{ ...inputStyle, width: 120, color: '#000', margin: 0 }}
                                >
                                  {selectedVmTypes.map(vmType => (
                                    <option key={vmType} value={vmType}>{vmType}</option>
                                  ))}
                                </select>
                              </td>
                              {/* Query Name */}
                              <td style={{ border: '1px solid #ddd', padding: 4 }}>
                                <select
                                  value={cond.query}
                                  onChange={e => handleNodeRuleConditionChange(ruleIdx, condIdx, 'query', e.target.value)}
                                  style={{ ...inputStyle, width: 140, color: '#000', margin: 0 }}
                                >
                                  {selectedNodeQueries.map(query => (
                                    <option key={query} value={query}>{query}</option>
                                  ))}
                                </select>
                              </td>
                              {/* Operator */}
                              <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center' }}>
                                <select
                                  value={cond.comparisonOperator || '>'}
                                  onChange={e => handleNodeRuleConditionChange(ruleIdx, condIdx, 'comparisonOperator', e.target.value as '>' | '<')}
                                  style={{ ...inputStyle, width: 60, color: '#000', margin: 0 }}
                                >
                                  <option value=">">&gt;</option>
                                  <option value="<">&lt;</option>
                                </select>
                              </td>
                              {/* Threshold Value */}
                              <td style={{ border: '1px solid #ddd', padding: 4 }}>
                                <input
                                  type="text"
                                  value={cond.threshold}
                                  onChange={e => handleNodeRuleConditionChange(ruleIdx, condIdx, 'threshold', e.target.value)}
                                  style={{ ...inputStyle, width: 90, color: '#000', margin: 0 }}
                                />
                              </td>
                              {/* Unit */}
                              <td style={{ border: '1px solid #ddd', padding: 2, textAlign: 'center', color: '#555', position: 'relative', width: 50, minWidth: 50, maxWidth: 50 }}>
                                <span style={{ position: 'absolute', left: 4, top: 8, fontWeight: 500, color: '#0078d4', fontSize: 13 }}>
                                  {cond.unit === 'Time (ms)'
                                    ? 'ms'
                                    : cond.unit === 'Memory (GB)'
                                      ? 'GB'
                                      : cond.unit === 'Percentage'
                                        ? '%'
                                        : cond.unit === 'Count'
                                          ? '#'
                                          : 'GB'}
                                </span>
                                <select
                                  value={cond.unit || 'Memory (GB)'}
                                  onChange={e => handleNodeRuleConditionChange(ruleIdx, condIdx, 'unit', e.target.value as 'Memory (GB)' | 'Time (ms)' | 'Percentage' | 'Count')}
                                  style={{ ...inputStyle, width: 50, minWidth: 50, maxWidth: 50, color: 'transparent', margin: 0, position: 'relative', zIndex: 1, background: 'transparent', fontSize: 13, paddingLeft: 18 }}
                                >
                                  {getAllowedUnits(cond.query).map(unitOpt => (
                                    <option key={unitOpt} value={unitOpt}>{unitOpt}</option>
                                  ))}
                                </select>
                              </td>
                              {/* Logical Operator and Delete Button */}
                              <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                                {condIdx < rule.conditions.length - 1 ? (
                                  <select
                                    value={cond.operator}
                                    onChange={e => handleNodeRuleConditionChange(ruleIdx, condIdx, 'operator', e.target.value as 'AND' | 'OR')}
                                    style={{ ...inputStyle, width: 85, color: '#000', margin: 0 }}
                                  >
                                    <option value="AND">AND</option>
                                    <option value="OR">OR</option>
                                  </select>
                                ) : ''}
                                {/* Delete Condition Button */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNodeCondition(ruleIdx, condIdx)}
                                  style={{
                                    background: '#ff4d4f',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '2px 8px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: 13,
                                    marginLeft: 4
                                  }}
                                  title="Delete Condition"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  <button type="button" onClick={() => handleAddNodeCondition(ruleIdx)} style={{ marginTop: 6, background: '#e6f0fa', color: '#0078d4', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 500, cursor: 'pointer' }}>
                    + Add Condition
                  </button>
                </div>
              ))}
              <button type="button" onClick={handleAddNodeRule} className="btn btn-primary" style={{ borderRadius: 8, padding: '12px 24px', fontWeight: 600, fontSize: 15, boxShadow: '0 2px 8px rgba(0,120,212,0.25)' }}>
                <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>add</i>
                Add Node Rule
              </button>
            </div>
          </div>
        )}

        {duplicateError && (
          <div style={{ color: 'red', fontWeight: 600, marginBottom: 12 }}>{duplicateError}</div>
        )}
        {showSuccess && (
  <div style={{ marginTop: 16 }}>
    <div style={{
      padding: '20px',
      backgroundColor: '#d4edda',
      border: '1px solid #c3e6cb',
      borderRadius: 8,
      color: '#155724',
      fontSize: 16,
      lineHeight: 1.6
    }}>
      {onboardingForm?.ncmLabel ? (
        <>
          🎉 <strong>Congratulations!</strong>
          <br /><br />
          Your TestBed "<strong>{onboardingForm?.ncmLabel || 'Default'}</strong>" is being monitored by NCM monitoring tool. Any anomalies observed as per the above rules would be notified on slack channel <strong>#ncm_monitoring</strong>.
          <br /><br />
          You may also look at{' '}
          <a
            href={onboardingForm?.prometheusEndpoint || `http://${onboardingForm?.pcIp}:9090`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0078d4', fontWeight: 600, textDecoration: 'underline' }}
          >
            {onboardingForm?.prometheusEndpoint || `http://${onboardingForm?.pcIp}:9090`}
          </a>{' '}
          for live alerts.
        </>
      ) : (
        <>
          Rule config is saved successfully.
          <br />
          Monitoring will begin after the completion of NCM deployment and ENV setup.
        </>
      )}
    </div>

    {/* Buttons outside the green box */}
    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
      {onboardingForm?.ncmLabel && (
        <button
          type="button"
          onClick={() => setShowSuccess(false)}
          style={{
            background: '#0078d4',
            color: '#fff',
            padding: '8px 16px',
            border: 'none',
            borderRadius: 4,
            fontWeight: 500,
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          Edit Rules
        </button>
      )}
      <button
        type="button"
        onClick={() => navigate('/dynamic-workload')}
        style={{
          background: 'transparent',
          color: '#0078d4',
          border: '1px solid #0078d4',
          borderRadius: 4,
          padding: '8px 16px',
          fontWeight: 500,
          cursor: 'pointer',
          fontSize: 14
        }}
      >
        Dynamic Workload
      </button>
    </div>
  </div>
)}





        {/* Save Rule Button */}
        {/* Submit button (only when not successful yet) */}
          {!showSuccess && (
            <button
              type="button"
              onClick={handleSave}
              className="btn btn-primary btn-lg w-100"
              style={{
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 16,
                padding: '14px 0',
                marginTop: 24,
                boxShadow: '0 4px 12px rgba(0,120,212,0.25)',
                transition: 'all 0.2s'
              }}
            >
              <i className="material-icons-outlined" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 8 }}>save</i>
              Submit Rules
            </button>
          )}

      </div>
      </div>
    </div>
  );
}

export default RuleBuilderExperimental;
