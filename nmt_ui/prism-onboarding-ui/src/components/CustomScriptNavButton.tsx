import React from 'react';

interface CustomScriptNavButtonProps {
  isActive: boolean;
  onToggle: () => void;
}

const CustomScriptNavButton: React.FC<CustomScriptNavButtonProps> = ({
  isActive,
  onToggle
}) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        background: isActive ? '#0078d4' : 'transparent',
        color: isActive ? '#fff' : '#0078d4',
        border: 'none',
        borderRight: '1px solid #e0e6ef',
        padding: '0 18px',
        height: 54,
        fontWeight: 600,
        cursor: 'pointer',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        outline: 'none',
        transition: 'background 0.2s',
      }}
    >
      {/* Upload icon SVG */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: 6 }}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10,9 9,9 8,9" />
      </svg>
      Upload Custom Script
    </button>
  );
};

export default CustomScriptNavButton;
