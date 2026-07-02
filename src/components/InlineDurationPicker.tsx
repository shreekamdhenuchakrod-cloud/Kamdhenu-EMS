import React, { useState, useEffect, useRef } from 'react';

// Looping offset helpers
const getHourOffset = (current: number, offset: number) => {
  let val = (current + offset) % 24;
  if (val < 0) val += 24;
  return val;
};

const getMinuteOffset = (current: number, offset: number) => {
  let val = (current + offset) % 60;
  if (val < 0) val += 60;
  return val;
};

interface WheelColumnProps<T> {
  value: T;
  onChange: (val: T) => void;
  getOffsetValue: (current: T, offset: number) => T;
  format?: (val: T) => string;
}

const ITEM_HEIGHT = 30;

function WheelColumn<T>({
  value,
  onChange,
  getOffsetValue,
  format = (v) => String(v)
}: WheelColumnProps<T>) {
  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);

  const handleStart = (clientY: number) => {
    isDraggingRef.current = true;
    startYRef.current = clientY;
    setDragOffset(0);
  };

  const handleMove = (clientY: number) => {
    if (!isDraggingRef.current) return;
    const diff = clientY - startYRef.current;
    // Damp dragging slightly for extreme control
    setDragOffset(diff);
  };

  const handleEnd = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    
    const slots = Math.round(-dragOffset / ITEM_HEIGHT);
    if (slots !== 0) {
      const newValue = getOffsetValue(value, slots);
      onChange(newValue);
    }
    setDragOffset(0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const divisor = 60;
    const delta = Math.round(e.deltaY / divisor);
    if (delta !== 0) {
      const slots = delta > 0 ? 1 : -1;
      const newValue = getOffsetValue(value, slots);
      onChange(newValue);
    }
  };

  useEffect(() => {
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current) {
        handleMove(e.touches[0].clientY);
      }
    };
    
    const handleGlobalTouchEnd = () => {
      if (isDraggingRef.current) {
        handleEnd();
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        handleMove(e.clientY);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        handleEnd();
      }
    };

    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    window.addEventListener('touchend', handleGlobalTouchEnd);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [value, onChange]);

  const displayedItems = [
    { offset: -1, val: getOffsetValue(value, -1) },
    { offset: 0, val: value },
    { offset: 1, val: getOffsetValue(value, 1) }
  ];

  const translateY = Math.max(-ITEM_HEIGHT, Math.min(ITEM_HEIGHT, dragOffset));

  return (
    <div 
      onWheel={handleWheel}
      onMouseDown={(e) => handleStart(e.clientY)}
      onTouchStart={(e) => handleStart(e.touches[0].clientY)}
      className="relative w-[70px] h-[74px] overflow-hidden cursor-ns-resize select-none flex flex-col justify-center items-center"
      style={{ touchAction: 'none' }}
    >
      <div 
        className="w-full flex flex-col items-center justify-center transition-transform duration-75"
        style={{ transform: `translateY(${translateY}px)` }}
      >
        {displayedItems.map((item) => {
          const isSelected = item.offset === 0;
          return (
            <div
              key={item.offset}
              onClick={() => {
                if (item.offset !== 0) {
                  onChange(item.val);
                }
              }}
              className={`h-[30px] w-full flex items-center justify-center select-none text-center transition-all ${
                isSelected 
                  ? 'text-slate-900 font-extrabold text-xs scale-105 opacity-100' 
                  : 'text-slate-400 font-medium text-[10px] opacity-40 hover:opacity-70'
              }`}
            >
              {format(item.val)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface InlineDurationPickerProps {
  hours: number;
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
}

export default function InlineDurationPicker({
  hours,
  minutes,
  onChange
}: InlineDurationPickerProps) {
  return (
    <div className="relative border border-slate-100 bg-slate-50/55 rounded-xl px-3 py-1 flex items-center justify-center overflow-hidden h-[68px] max-w-[210px] mx-auto select-none shadow-inner-xs">
      {/* Symmetrical divider bounds aligned precisely above and below the center selection slot */}
      <div className="absolute left-4 right-4 top-[18px] h-[0.7px] bg-slate-300 pointer-events-none z-10" />
      <div className="absolute left-4 right-4 top-[49px] h-[0.7px] bg-slate-300 pointer-events-none z-10" />

      <div className="flex items-center justify-center gap-1 h-full relative z-2">
        <div className="flex flex-col items-center">
          <WheelColumn 
            value={hours}
            onChange={(h) => onChange(h, minutes)}
            getOffsetValue={getHourOffset}
            format={(h) => `${h}h`}
          />
        </div>

        <div className="text-slate-400 font-bold text-[10px] select-none mb-0.5">:</div>

        <div className="flex flex-col items-center">
          <WheelColumn 
            value={minutes}
            onChange={(m) => onChange(hours, m)}
            getOffsetValue={getMinuteOffset}
            format={(m) => `${String(m).padStart(2, '0')}m`}
          />
        </div>
      </div>
    </div>
  );
}
