import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'
import TrialBanner from '../Components/TrialBanner/TrialBanner'
import ErrorBoundary from '../Components/ErrorBoundary/ErrorBoundary'
import QMatePanel from '../Components/QMate/QMatePanel.jsx'
import { COLORS } from '../Components/Shared/index.js'

const MainPagesLayout = () => {
  const location = useLocation()
  const scrollContainerRef = useRef(null)
  const [showArrivalFlash, setShowArrivalFlash] = useState(false)
  const [qmatePanelOpen, setQmatePanelOpen] = useState(false)
  const onQMatePage = location.pathname.includes('qmate')

  // Reset scroll position when route changes
  useEffect(() => {
    const resetScroll = () => {
      // Reset the scroll container - this is the main scrollable area
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      }
      // Also reset window scroll
      window.scrollTo({ top: 0, behavior: 'instant' })
      
      // Also try to reset any nested scrollable containers that might have scrolled
      const nestedScrollContainers = document.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"]')
      nestedScrollContainers.forEach(container => {
        // Only reset containers that are actually scrolled and not the main container
        if (container !== scrollContainerRef.current && container.scrollTop > 0) {
          container.scrollTop = 0
        }
      })
    }

    // Reset immediately when route changes
    resetScroll()
    
    // Use requestAnimationFrame to ensure DOM is ready, then reset multiple times
    // This handles cases where content might render after the initial reset
    requestAnimationFrame(() => {
      resetScroll()
      // Multiple timeouts to catch different render phases
      setTimeout(resetScroll, 0)
      setTimeout(resetScroll, 10)
      setTimeout(resetScroll, 50)
      setTimeout(resetScroll, 100)
      // Additional delayed reset to catch any late-rendering content or animations
      setTimeout(resetScroll, 200)
      setTimeout(resetScroll, 300)
    })
  }, [location.pathname])

  // Brief highlight flash at the top of the page when arriving via a side-panel search result
  // that has no specific in-page target to scroll to (see NavSearch.jsx / searchablePages.js -
  // entries with their own `highlight` key scroll to and pulse a specific element instead).
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('searchArrival') !== '1') return
    setShowArrivalFlash(true)
    params.delete('searchArrival')
    const newSearch = params.toString()
    window.history.replaceState(null, '', `${location.pathname}${newSearch ? `?${newSearch}` : ''}`)
    const timer = setTimeout(() => setShowArrivalFlash(false), 1200)
    return () => clearTimeout(timer)
  }, [location.pathname, location.search])

  return (
    <div className='flex min-h-screen w-full overflow-x-hidden bg-[#1a1a1a]'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='relative flex-1 min-w-0 h-[100vh] flex flex-col overflow-x-hidden'>
            <TopNav/>
            <TrialBanner/>
            <div
              ref={scrollContainerRef}
              className={`relative flex-1 min-h-0 overflow-x-hidden scrollbar-hide ${onQMatePage ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}
              style={{ overscrollBehaviorY: 'auto', overscrollBehaviorX: 'contain', scrollBehavior: 'smooth' }}
            >
                {showArrivalFlash && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-28 z-20 bg-gradient-to-b from-blue-500/25 via-blue-500/10 to-transparent animate-pulse" />
                )}
                <div className={onQMatePage ? 'flex-1 min-h-0 flex flex-col lg:pt-0 pt-[8vh] pb-0' : 'lg:pt-0 pt-[8vh] pb-0'}>
                    <ErrorBoundary resetKey={location.pathname} title="Page Error" message="Something went wrong loading this page. Try navigating again or refreshing.">
                        <Outlet/>
                    </ErrorBoundary>
                </div>
            </div>
        </section>

        {/* Floating "Ask QMate" - available on every page under this layout except the
            QMate chat page itself (where it would be redundant). Opens a slide-in chat
            drawer in place, rather than navigating away to the full QMate page. */}
        {!onQMatePage && (
            <button
                type="button"
                onClick={() => setQmatePanelOpen(true)}
                className="fixed z-50 flex items-center gap-2 rounded-full shadow-2xl transition-colors"
                style={{
                    right: 26,
                    bottom: 26,
                    padding: '11px 16px 11px 12px',
                    border: '1px solid rgba(59,130,246,.45)',
                    background: COLORS.surface,
                    color: COLORS.textPrimary,
                    fontSize: 13,
                    fontWeight: 600,
                }}
            >
                <span
                    className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold"
                    style={{ background: COLORS.accent, color: '#061021' }}
                >
                    Q
                </span>
                Ask QMate
            </button>
        )}

        <QMatePanel isOpen={qmatePanelOpen} onClose={() => setQmatePanelOpen(false)} />
    </div>
  )
}

export default MainPagesLayout