import React, { useState, useEffect, useRef } from 'react';

interface TimeWheelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initialValue: string; // "HH:mm"
  onSave: (finalTime: string) => void;
}

// Looping value offset helpers
const getHourAtOffset = (current: number, offset: number) => {
  let val = (current + offset) % 12;
  if (val <= 0) val += 12;
  return val;
};

const getMinuteAtOffset = (current: number, offset: number) => {
  let val = (current + offset) % 60;
  if (val < 0) val += 60;
  return val;
};

const getAmpmAtOffset = (current: 'AM' | 'PM', offset: number) => {
  const isOdd = Math.abs(offset) % 2 === 1;
  if (!isOdd) return current;
  return current === 'AM' ? 'PM' : 'AM';
};

interface WheelColumnProps<T> {
  value: T;
  onChange: (val: T) => void;
  getOffsetValue: (current: T, offset: number) => T;
  format?: (val: T) => string;
}

const ITEM_HEIGHT = 44;

function WheelColumn<T>({
  value,
  onChange,
  getOffsetValue,
  format = (v) => String(v)
}: WheelColumnProps<T>) {
  const [localValue, setLocalValue] = useState<T>(value);
  const localValueRef = useRef<T>(value);

  // Keep localState/Ref perfectly in sync with incoming parent prop value updates
  useEffect(() => {
    setLocalValue(value);
    localValueRef.current = value;
  }, [value]);

  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const startYRef = useRef(0);

  const animateToSlot = (slots: number, startFromOffset: number) => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;
    isDraggingRef.current = false;
    
    const targetOffset = -slots * ITEM_HEIGHT;
    const duration = 120; // Faster and more magnetic
    const startTime = performance.now();
    
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic for a snappier, magnetic settle
      const ease = 1 - Math.pow(1 - progress, 3);
      const currentOffset = startFromOffset + (targetOffset - startFromOffset) * ease;
      
      setDragOffset(currentOffset);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        const newValue = getOffsetValue(localValueRef.current, slots);
        localValueRef.current = newValue;
        setLocalValue(newValue);
        onChange(newValue);
        setDragOffset(0);
        isAnimatingRef.current = false;
      }
    };
    
    requestAnimationFrame(animate);
  };

  // Use the latest ref pattern to eliminate stale closure bugs
  const latestRef = useRef({
    getOffsetValue,
    onChange,
    dragOffset,
    animateToSlot,
    handleMove: (clientY: number) => {
      if (!isDraggingRef.current || isAnimatingRef.current) return;
      let diff = clientY - startYRef.current;
      let currentValue = localValueRef.current;
      let changed = false;

      // Smooth looping math during live scroll
      while (diff > ITEM_HEIGHT) {
        currentValue = latestRef.current.getOffsetValue(currentValue, -1);
        startYRef.current += ITEM_HEIGHT;
        diff = clientY - startYRef.current;
        changed = true;
      }
      while (diff < -ITEM_HEIGHT) {
        currentValue = latestRef.current.getOffsetValue(currentValue, 1);
        startYRef.current -= ITEM_HEIGHT;
        diff = clientY - startYRef.current;
        changed = true;
      }

      if (changed) {
        localValueRef.current = currentValue;
        setLocalValue(currentValue);
        // Note: We do NOT trigger onChange here during movement to prevent React parent re-render lag.
        // It renders purely locally at 60fps for absolute butter-smooth responsiveness.
      }
      setDragOffset(diff);
    },
    handleEnd: () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      
      const slots = Math.round(-latestRef.current.dragOffset / ITEM_HEIGHT);
      latestRef.current.animateToSlot(slots, latestRef.current.dragOffset);
    }
  });

  // Keep ref up-to-date on every single render
  latestRef.current = {
    getOffsetValue,
    onChange,
    dragOffset,
    animateToSlot,
    handleMove: (clientY: number) => {
      if (!isDraggingRef.current || isAnimatingRef.current) return;
      let diff = clientY - startYRef.current;
      let currentValue = localValueRef.current;
      let changed = false;

      while (diff > ITEM_HEIGHT) {
        currentValue = latestRef.current.getOffsetValue(currentValue, -1);
        startYRef.current += ITEM_HEIGHT;
        diff = clientY - startYRef.current;
        changed = true;
      }
      while (diff < -ITEM_HEIGHT) {
        currentValue = latestRef.current.getOffsetValue(currentValue, 1);
        startYRef.current -= ITEM_HEIGHT;
        diff = clientY - startYRef.current;
        changed = true;
      }

      if (changed) {
        localValueRef.current = currentValue;
        setLocalValue(currentValue);
      }
      setDragOffset(diff);
    },
    handleEnd: () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      
      const slots = Math.round(-latestRef.current.dragOffset / ITEM_HEIGHT);
      latestRef.current.animateToSlot(slots, latestRef.current.dragOffset);
    }
  };

  const handleStart = (clientY: number) => {
    if (isAnimatingRef.current) return;
    isDraggingRef.current = true;
    startYRef.current = clientY;
    setDragOffset(0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isAnimatingRef.current) return;
    const divisor = 60;
    const delta = Math.round(e.deltaY / divisor);
    if (delta !== 0) {
      const slots = delta > 0 ? 1 : -1;
      animateToSlot(slots, 0);
    }
  };

  useEffect(() => {
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current) {
        if (e.cancelable) {
          e.preventDefault();
        }
        latestRef.current.handleMove(e.touches[0].clientY);
      }
    };
    
    const handleGlobalTouchEnd = () => {
      if (isDraggingRef.current) {
        latestRef.current.handleEnd();
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        latestRef.current.handleMove(e.clientY);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        latestRef.current.handleEnd();
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
  }, []);

  const displayedItems = [
    { offset: -2, val: getOffsetValue(localValue, -2) },
    { offset: -1, val: getOffsetValue(localValue, -1) },
    { offset: 0, val: localValue },
    { offset: 1, val: getOffsetValue(localValue, 1) },
    { offset: 2, val: getOffsetValue(localValue, 2) }
  ];

  const translateY = dragOffset;

  return (
    <div className="flex flex-col items-center">
      {/* Up Button */}
      <button
        type="button"
        onClick={() => {
          if (isAnimatingRef.current || isDraggingRef.current) return;
          animateToSlot(-1, 0);
        }}
        className="w-10 h-7 text-slate-400 hover:text-blue-600 active:scale-90 flex items-center justify-center transition-all cursor-pointer rounded-lg hover:bg-slate-50 text-[10px]"
      >
        ▲
      </button>

      {/* Squeezed Wheel viewport */}
      <div 
        onWheel={handleWheel}
        onMouseDown={(e) => handleStart(e.clientY)}
        onTouchStart={(e) => handleStart(e.touches[0].clientY)}
        className="relative w-[70px] h-[132px] overflow-hidden cursor-ns-resize select-none flex flex-col justify-center items-center"
        style={{ touchAction: 'none' }}
      >
        <div 
          className="w-full flex flex-col items-center justify-center transition-none"
          style={{ transform: `translateY(${translateY}px)` }}
        >
          {displayedItems.map((item) => {
            const isSelected = item.offset === 0;
            return (
              <div
                key={item.offset}
                onClick={() => {
                  if (item.offset !== 0 && !isAnimatingRef.current && !isDraggingRef.current) {
                    animateToSlot(item.offset, 0);
                  }
                }}
                className={`h-[44px] w-full flex items-center justify-center select-none text-center transition-all ${
                  isSelected 
                    ? 'text-slate-950 font-black text-sm scale-110 opacity-100' 
                    : 'text-slate-400 font-medium text-xs opacity-40 hover:opacity-70'
                }`}
              >
                {format(item.val)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Down Button */}
      <button
        type="button"
        onClick={() => {
          if (isAnimatingRef.current || isDraggingRef.current) return;
          animateToSlot(1, 0);
        }}
        className="w-10 h-7 text-slate-400 hover:text-blue-600 active:scale-90 flex items-center justify-center transition-all cursor-pointer rounded-lg hover:bg-slate-50 text-[10px]"
      >
        ▼
      </button>
    </div>
  );
}

export default function TimeWheelPicker({
  isOpen,
  onClose,
  title,
  initialValue,
  onSave
}: TimeWheelPickerProps) {
  const [hour, setHour] = useState(4); // 1-12
  const [minute, setMinute] = useState(11); // 0-59
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('PM');

  // Parse time details from parent exactly once when picker opens
  useEffect(() => {
    if (initialValue && isOpen) {
      const [hStr, mStr] = initialValue.split(':');
      const h24 = parseInt(hStr, 10) || 0;
      const mVal = parseInt(mStr, 10) || 0;

      const flagPm = h24 >= 12;
      const dispHour = h24 % 12 === 0 ? 12 : h24 % 12;

      setHour(dispHour);
      setMinute(mVal);
      setAmpm(flagPm ? 'PM' : 'AM');
    }
  }, [initialValue, isOpen]);

  if (!isOpen) return null;

  // Custom Hour change wrapper to support auto AM/PM switching at the 11 <-> 12 threshold
  const handleHourChange = (newHour: number) => {
    const prev = hour;
    setHour(newHour);
    if ((prev === 11 && newHour === 12) || (prev === 12 && newHour === 11)) {
      setAmpm((curr) => curr === 'AM' ? 'PM' : 'AM');
    }
  };

  const handleSave = () => {
    let finalHr = hour; // 1-12
    if (ampm === 'PM' && finalHr < 12) {
      finalHr += 12;
    } else if (ampm === 'AM' && finalHr === 12) {
      finalHr = 0;
    }
    const finalTimeStr = `${String(finalHr).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    onSave(finalTimeStr);
  };

  // Convert date title to "19 Jun | Fri" if valid date
  let parsedSubtitle = title;
  if (title) {
    const d = new Date(title);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const monthStr = d.toLocaleDateString('en-GB', { month: 'short' });
      const weekdayStr = d.toLocaleDateString('en-GB', { weekday: 'short' });
      parsedSubtitle = `${day} ${monthStr} | ${weekdayStr}`;
    }
  }

  // Format header display label based on "in" or "out"
  const headerLabel = title.toLowerCase().includes('in') ? 'Punch In Time' : 'Punch Out Time';

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center z-[250] p-4 transition-opacity duration-200">
      
      {/* Sleek, JPEG-matching clean custom layout */}
      <div className="bg-white w-full max-w-[280px] rounded-2xl pb-5 pt-5 shadow-xl border border-slate-100 flex flex-col select-none animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header Title Information */}
        <div className="px-5 pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-sans tracking-tight">
                {headerLabel}
              </h3>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">{parsedSubtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 font-sans text-sm transition-colors cursor-pointer p-0.5"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Picker Wheel Arena */}
        <div className="flex items-center justify-center bg-white px-4 py-2 relative h-[142px]">
          
          {/* Symmetrical divider bounds aligned precisely above and below the center selection slot */}
          <div className="absolute left-6 right-6 top-[48px] h-[0.7px] bg-slate-350 pointer-events-none z-10" />
          <div className="absolute left-6 right-6 top-[92px] h-[0.7px] bg-slate-350 pointer-events-none z-10" />

          <div className="flex items-center justify-center w-full gap-2 h-full overflow-hidden relative">
            
            {/* Hour Selector Column */}
            <WheelColumn 
              value={hour}
              onChange={handleHourChange}
              getOffsetValue={getHourAtOffset}
              format={(h) => String(h)}
            />

            {/* Separator Sign */}
            <div className="flex items-center justify-center text-slate-400 font-semibold text-xs h-full w-2">
              :
            </div>

            {/* Minute Selector Column */}
            <WheelColumn 
              value={minute}
              onChange={setMinute}
              getOffsetValue={getMinuteAtOffset}
              format={(m) => String(m).padStart(2, '0')}
            />

            {/* AM/PM Selector Column */}
            <WheelColumn 
              value={ampm}
              onChange={setAmpm}
              getOffsetValue={getAmpmAtOffset}
              format={(p) => p}
            />

          </div>
        </div>

        {/* Action Button */}
        <div className="px-5 pt-3">
          <button
            onClick={handleSave}
            className="w-full h-10 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-lg font-bold text-xs tracking-wide shadow-sm transition-all cursor-pointer flex items-center justify-center animate-none"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
