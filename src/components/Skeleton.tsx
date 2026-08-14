import React from 'react';

interface SkeletonLoaderProps {
  width: number | string;
  height: number | string;
  style?: React.CSSProperties;
  darkMode?: boolean;
  children?: React.ReactNode;
  show?: boolean;
  borderRadius?: number;
  className?: string;
}

const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width,
  height,
  style,
  darkMode = true,
  children,
  show = true,
  borderRadius = 10,
  className = '',
}) => {
  if (children && !show) return <>{children}</>;

  const baseStyle: React.CSSProperties = {
    width,
    height,
    borderRadius,
    overflow: 'hidden',
    backgroundColor: darkMode ? 'rgba(255,255,255,0.04)' : '#E0E0E0',
    position: 'relative',
    ...style,
  };

  const shimmerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: darkMode
      ? 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)'
      : 'linear-gradient(90deg, #E0E0E0 0%, #F5F5F5 50%, #E0E0E0 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
  };

  return (
    <div style={baseStyle} className={className}>
      <div style={shimmerStyle} />
    </div>
  );
};

export default SkeletonLoader;
