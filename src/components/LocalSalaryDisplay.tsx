import React, { useState } from 'react';
import Icon from './Icon';

interface LocalSalaryDisplayProps {
  value: number;
  format?: (val: number) => string;
  className?: string;
  suffix?: string;
  isPaymentRate?: boolean;
}

export default function LocalSalaryDisplay({
  value,
  format,
  className = '',
  suffix = '',
  isPaymentRate = false,
}: LocalSalaryDisplayProps) {
  const [show, setShow] = useState(false);

  const displayVal = format ? format(value) : value.toString();
  const maskedVal = format ? format(value).replace(/[0-9.]/g, '*') : '***';

  if (!isPaymentRate) {
    return <span className={className}>{displayVal}{suffix}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono">
        {show ? `${displayVal}${suffix}` : `${maskedVal}${suffix}`}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShow(!show);
        }}
        className="text-slate-400 hover:text-slate-600 transition-colors p-1 -m-1"
        title={show ? 'Hide rate' : 'Show rate'}
      >
        <Icon name={show ? 'visibility' : 'visibility_off'} size={14} />
      </button>
    </span>
  );
}
