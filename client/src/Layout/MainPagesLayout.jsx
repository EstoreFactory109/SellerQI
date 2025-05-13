import { Outlet } from 'react-router-dom'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'

const MainPagesLayout = () => {

  return (
    <div className='flex min-h-screen'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='w-full h-[100vh] overflow-hidden'>
            <TopNav/>
            <Outlet/>
        </section>
    </div>
  )
}

export default MainPagesLayout