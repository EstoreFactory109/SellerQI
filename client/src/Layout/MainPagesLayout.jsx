import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'
import TrialBanner from '../Components/TrialBanner/TrialBanner'

const MainPagesLayout = () => {
  const location = useLocation()
  const scrollContainerRef = useRef(null)

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

  return (
    <div className='flex min-h-screen w-full overflow-x-hidden bg-[#1a1a1a]'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='flex-1 min-w-0 h-[100vh] flex flex-col overflow-x-hidden'>
            <TopNav/>
            <TrialBanner/>
            <div 
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide" 
              style={{ overscrollBehaviorY: 'auto', overscrollBehaviorX: 'contain', scrollBehavior: 'smooth' }}
            >
                <div className="lg:pt-0 pt-[8vh] pb-0">
                    <Outlet/>
                </div>
            </div>
        </section>
    </div>
  )
}

export default MainPagesLayout