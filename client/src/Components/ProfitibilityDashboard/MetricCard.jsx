import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign, Percent, List, TrendingUp, TrendingDown, Zap, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { COLORS } from '../Shared/index.js';

const EXPENSES_LABEL = 'Expenses';
const EXPENSES_DROPDOWN_WIDTH = 340;

const MetricCard = ({ label, value, icon, breakdown, isExpandable, currency = '$', caption, tintColor }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [dropdownPos, setDropdownPos] = useState(null);
    const cardRef = useRef(null);

    const getIconComponent = (iconType) => {
      switch (iconType) {
        case 'dollar-sign': return DollarSign;
        case 'percent': return Percent;
        case 'list': return List;
        case 'trending-up': return TrendingUp;
        case 'trending-down': return TrendingDown;
        case 'zap': return Zap;
        case 'target': return Target;
        default: return DollarSign;
      }
    };

    const IconComponent = getIconComponent(icon);
    const hasBreakdown = Array.isArray(breakdown) && breakdown.length > 0;
    const canExpand = isExpandable && hasBreakdown;

    const updateDropdownPosition = useCallback(() => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const width = label === EXPENSES_LABEL ? EXPENSES_DROPDOWN_WIDTH : Math.max(rect.width, 200);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setDropdownPos({
        top: rect.bottom + 4,
        left,
        width,
      });
    }, [label]);

    useEffect(() => {
      if (!isOpen || !canExpand) {
        setDropdownPos(null);
        return;
      }
      updateDropdownPosition();
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }, [isOpen, canExpand, updateDropdownPosition]);

    const handleClick = (e) => {
      if (!canExpand) return;
      e.stopPropagation();
      setIsOpen((prev) => !prev);
    };

    const dropdownPanel = (
      <AnimatePresence>
        {isOpen && hasBreakdown && dropdownPos && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg overflow-hidden shadow-lg max-h-60 overflow-y-auto"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 10050,
              background: COLORS.surfaceElevated,
              border: `1px solid ${COLORS.border}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2">
              {breakdown.map((item, idx) => {
                const amt = Number(item.amount || 0);
                const amtColor = amt > 0 ? COLORS.good : amt < 0 ? '#F87171' : COLORS.textSecondary;
                return (
                  <div
                    key={`${item.label}-${idx}`}
                    className="flex items-center justify-between px-2 py-1.5 rounded"
                    style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(59,130,246,0.06)' }}
                  >
                    <span className="text-[10px] mr-2" style={{ color: COLORS.textSecondary }}>{item.label}</span>
                    <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: amtColor }}>
                      {currency}{amt.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );

    return (
      <div ref={cardRef} className="relative">
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.2 }}
          className="group rounded-lg transition-all duration-300 flex flex-col w-full"
          style={{ background: COLORS.surface, border: `1px solid ${tintColor || COLORS.border}`, borderRadius: '12px', padding: '14px 16px', cursor: canExpand ? 'pointer' : 'default' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = tintColor || COLORS.border; }}
          onClick={handleClick}
        >
          <div className="flex items-center gap-2 mb-2">
            <IconComponent className="w-4 h-4" style={{ color: COLORS.textMuted }} />
            <div className="text-[11px] font-medium uppercase tracking-wide flex-1" style={{ color: COLORS.textSecondary }}>
              {label}
            </div>
            {canExpand && (
              isOpen
                ? <ChevronUp className="w-3.5 h-3.5" style={{ color: COLORS.textMuted }} />
                : <ChevronDown className="w-3.5 h-3.5" style={{ color: COLORS.textMuted }} />
            )}
          </div>
          <div className="text-[21px] font-bold transition-colors duration-200 truncate" style={{ color: COLORS.textPrimary }}>
            {value}
          </div>
          {caption && (
            <div className="text-[12px] mt-1.5 truncate" style={{ color: tintColor || COLORS.textMuted }}>
              {caption}
            </div>
          )}
        </motion.div>

        {typeof document !== 'undefined' && createPortal(dropdownPanel, document.body)}
      </div>
    );
  };

  export default MetricCard;
