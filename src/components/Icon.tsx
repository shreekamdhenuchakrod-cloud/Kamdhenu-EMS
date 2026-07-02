import React from 'react';

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
}

export default function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  className = '',
  ...props
}: IconProps) {
  return (
    <span
      className={`material-symbols-rounded select-none ${className}`}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
        width: `${size}px`,
        height: `${size}px`,
        lineHeight: 1,
      }}
      {...props}
    >
      {name}
    </span>
  );
}
