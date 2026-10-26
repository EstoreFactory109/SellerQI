import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Globe } from 'lucide-react'
import useMarketplace, { ALL_MARKETPLACES } from '../../hooks/useMarketplace.js'
import MarketplaceLabel from './MarketplaceLabel.jsx'
import { getMarketplaceCurrencyCode } from '../../utils/amazonAllowedCountries.js'
import { COLORS } from '../Shared/index.js'

const Item = ({ active, onClick, children }) => (
  <button
    type='button'
    role='option'
    aria-selected={active}
    onClick={onClick}
    className='w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-[13px] transition-colors hover:bg-[#252C3A]'
    style={{ color: COLORS.textPrimary }}
  >
    <span className='flex-1 min-w-0'>{children}</span>
    {active && <Check className='w-3.5 h-3.5 flex-none' style={{ color: COLORS.accent }} />}
  </button>
)

/**
 * A page's own marketplace picker (replaces the app-wide TopNav pill).
 *
 * Renders nothing when VITE_PER_PAGE_MARKETPLACE is 'false', or when the user has a single
 * marketplace (there is nothing to choose). `allowAll` adds "All marketplaces" — the
 * Dashboard only.
 */
const MarketplaceSwitcher = ({ allowAll = false, className = '' }) => {
  const { enabled, selected, isAll, marketplaces, select } = useMarketplace({ allowAll })
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!enabled || marketplaces.length < 2) return null

  const choose = (target) => {
    setOpen(false)
    select(target)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-label='Choose marketplace'
        className='flex items-center gap-2 px-[12px] py-[8px] rounded-lg border text-[13px] font-medium transition-colors'
        style={{ background: COLORS.surface, borderColor: open ? '#3B4658' : COLORS.border, color: COLORS.textPrimary }}
      >
        {isAll ? (
          <span className='inline-flex items-center gap-1.5'><Globe className='w-3.5 h-3.5' style={{ color: COLORS.accent }} />All marketplaces</span>
        ) : (
          <MarketplaceLabel countryCode={selected?.country} textClassName='whitespace-nowrap' />
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: COLORS.textMuted }} />
      </button>

      {open && (
        <div
          role='listbox'
          className='absolute right-0 top-[calc(100%+6px)] z-[60] min-w-[15rem] rounded-[10px] border p-1.5 shadow-xl'
          style={{ background: '#1C2230', borderColor: COLORS.border }}
        >
          {allowAll && (
            <>
              <Item active={isAll} onClick={() => choose(ALL_MARKETPLACES)}>
                <span className='inline-flex items-center gap-1.5'><Globe className='w-3.5 h-3.5' style={{ color: COLORS.accent }} />All marketplaces</span>
                <span className='block text-[11px]' style={{ color: COLORS.textMuted }}>Side by side, each in its own currency</span>
              </Item>
              <div className='h-px my-1' style={{ background: COLORS.border }} />
            </>
          )}
          {marketplaces.map((m) => (
            <Item
              key={`${m.country}:${m.region}`}
              active={!isAll && selected?.country === m.country && selected?.region === m.region}
              onClick={() => choose(m)}
            >
              <span className='flex items-center justify-between gap-3'>
                <MarketplaceLabel countryCode={m.country} />
                <span className='text-[11px]' style={{ color: COLORS.textMuted }}>
                  {getMarketplaceCurrencyCode(m.country)}{m.isConnected ? '' : ' · not connected'}
                </span>
              </span>
            </Item>
          ))}
        </div>
      )}
    </div>
  )
}

export default MarketplaceSwitcher
