import React from 'react';
import { useNavigate } from 'react-router-dom';

// Import the component directly - it already has its own layout
import TestbedConfiguration from './TestbedConfiguration';

const DeployNew: React.FC = () => {
  // TestbedConfiguration already has breadcrumb and layout built-in
  // Just render it directly
  return <TestbedConfiguration />;
};

export default DeployNew;
