import { Outlet } from 'react-router-dom'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'
import TrialBanner from '../Components/TrialBanner/TrialBanner'

const MainPagesLayout = () => {

  return (
    <div className='flex min-h-screen'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='w-full h-[100vh] flex flex-col'>
            <TopNav/>
            <TrialBanner/>
            <div className="flex-1 overflow-y-auto">
                <Outlet/>
            </div>
        </section>
    </div>
  )
}

export default MainPagesLayout