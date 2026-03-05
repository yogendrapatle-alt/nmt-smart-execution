import React, { createContext, useContext, useState } from 'react';
import type { OnboardingForm } from '../types/onboarding';

export interface RuleBuilderSelections {
  ncm_label?: string;
  namespace?: string;
  pod_name?: string;
  metrics?: Array<{ name: string; condition: string }>;
}

interface OnboardingContextType {
  onboardingForm: OnboardingForm | null;
  setOnboardingForm: (form: OnboardingForm) => void;
  ruleSelections: RuleBuilderSelections | null;
  setRuleSelections: (selections: RuleBuilderSelections) => void; 
  updatePrometheusEndpoint: (endpoint: string) => void;  // ADD THIS TO UPDATE PROMETHEUS ENDPOINT
  updatePcUuid: (uuid: string) => void;  // ADD THIS TO UPDATE PC UUID
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm | null>(null);
  const [ruleSelections, setRuleSelections] = useState<RuleBuilderSelections | null>(null);

  // ADD THIS FUNCTION FOR ENDPOINT UPDATES
  const updatePrometheusEndpoint = (endpoint: string) => {
    setOnboardingForm(prev => 
      prev ? { ...prev, prometheusEndpoint: endpoint } : null
    );
  };

  // ADD THIS FUNCTION FOR UUID UPDATES
  const updatePcUuid = (uuid: string) => {
    setOnboardingForm(prev => 
      prev ? { ...prev, pcUuid: uuid } : null
    );
  };

  return (
    <OnboardingContext.Provider value={{ onboardingForm, setOnboardingForm, ruleSelections, setRuleSelections, updatePrometheusEndpoint, updatePcUuid }}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
};
