import React, { useState, useCallback, memo } from 'react';
import { Calendar, ChevronRight, AlertTriangle, ChevronDown, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Move HolidayItem outside to prevent recreation on every render
const HolidayItem = memo(({ holiday, idx, isAdditional = false, monthKey, getTypeColor }) => (
  <motion.div 
    key={`${monthKey}-${holiday.day}-${holiday.name}`} 
    initial={{ opacity: 0, x: isAdditional ? -20 : -10, height: isAdditional ? 0 : 'auto' }}
    animate={{ opacity: 1, x: 0, height: 'auto' }}
    exit={{ opacity: 0, x: -20, height: 0 }}
    transition={{ 
      duration: 0.4, 
      delay: isAdditional ? idx * 0.08 : idx * 0.05,
      ease: "easeOut"
    }}
    className="flex items-start gap-3 text-sm group hover:bg-gray-50/50 p-2 rounded-lg transition-colors duration-200 overflow-hidden"
  >
    <span className={`${getTypeColor(holiday.type)} w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5 shadow-sm`}>
      {holiday.day}
    </span>
    <span className="flex-1 text-gray-700 group-hover:text-gray-900 transition-colors duration-200">
      {holiday.name}
      {holiday.flag && <span className="ml-2">{holiday.flag}</span>}
    </span>
  </motion.div>
));

HolidayItem.displayName = 'HolidayItem';

// Monthly Calendar Modal Component
const MonthlyCalendarModal = memo(({ isOpen, onClose, month, monthKey, data }) => {
  const getTypeColor = useCallback((type) => {
    switch (type) {
      case 'holiday': return 'bg-red-500';
      case 'sports': return 'bg-blue-500';
      case 'awareness': return 'bg-purple-500';
      case 'other': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  }, []);

  const getTypeColorDot = useCallback((type) => {
    switch (type) {
      case 'holiday': return 'bg-red-500';
      case 'sports': return 'bg-blue-500';
      case 'awareness': return 'bg-purple-500';
      case 'other': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  }, []);

  // Create calendar grid for the month
  const createCalendarGrid = () => {
    const daysInMonth = new Date(2025, getMonthNumber(month), 0).getDate();
    const firstDayOfMonth = new Date(2025, getMonthNumber(month) - 1, 1).getDay();
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Create array of calendar days
    const calendarDays = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      calendarDays.push({ day: '', isEmpty: true });
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const holiday = data.holidays.find(h => h.day === day);
      calendarDays.push({ 
        day, 
        isEmpty: false, 
        holiday,
        isWeekend: [0, 6].includes(new Date(2025, getMonthNumber(month) - 1, day).getDay())
      });
    }
    
    return { calendarDays, daysOfWeek };
  };

  const getMonthNumber = (monthName) => {
    const months = {
      'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
      'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
    };
    return months[monthName] || 1;
  };

  const { calendarDays, daysOfWeek } = createCalendarGrid();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white rounded-xl shadow-2xl w-[900px] h-[700px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white p-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{month} 2025 ECOMMERCE HOLIDAYS</h2>
                {data.theme && (
                  <p className="text-slate-200 mt-1 italic">{data.theme}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-600 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Calendar Content */}
            <div className="p-6">
              {/* Calendar Grid */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Days of Week Header */}
                <div className="grid grid-cols-7 bg-gray-800 text-white">
                  {daysOfWeek.map(day => (
                    <div key={day} className="px-4 py-3 text-center text-sm font-semibold">
                      {day.slice(0, 3).toUpperCase()}
                    </div>
                  ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 h-[400px]">
                  {calendarDays.map((dayData, index) => (
                    <div
                      key={index}
                      className={`border-r border-b border-gray-200 p-2 ${
                        dayData.isEmpty ? 'bg-gray-50' : 'bg-white'
                      } ${dayData.isWeekend ? 'bg-red-50' : ''}`}
                    >
                      {!dayData.isEmpty && (
                        <>
                          <div className={`text-sm font-medium mb-1 ${
                            dayData.isWeekend ? 'text-red-600' : 'text-gray-900'
                          }`}>
                            {dayData.day}
                          </div>
                          {dayData.holiday && (
                            <div className="space-y-1">
                              <div className="flex items-start gap-1">
                                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getTypeColorDot(dayData.holiday.type)}`}></div>
                                <div className="text-xs text-gray-700 leading-tight">
                                  {dayData.holiday.name}
                                  {dayData.holiday.flag && <span className="ml-1">{dayData.holiday.flag}</span>}
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 text-center">Event Types</h3>
                <div className="flex flex-wrap justify-center items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <span className="text-sm font-medium text-gray-700">Holiday</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span className="text-sm font-medium text-gray-700">Sports</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                    <span className="text-sm font-medium text-gray-700">Awareness</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-sm font-medium text-gray-700">Other</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

MonthlyCalendarModal.displayName = 'MonthlyCalendarModal';

// Move MonthCard outside to prevent recreation on every render
const MonthCard = memo(({ month, monthKey, data, index, isExpanded, onToggleExpansion }) => {
  const hasMoreHolidays = data.holidays.length > 5;
  const initialHolidays = data.holidays.slice(0, 5);
  const additionalHolidays = data.holidays.slice(5);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const getTypeColor = useCallback((type) => {
    switch (type) {
      case 'holiday': return 'bg-red-500';
      case 'sports': return 'bg-blue-500';
      case 'awareness': return 'bg-purple-500';
      case 'other': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  }, []);

  const handleMonthClick = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: index * 0.1 }}
        className="bg-gradient-to-br from-white to-gray-50/50 rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 transform border border-gray-200/80 flex flex-col h-full"
        style={{
          boxShadow: `
            0 10px 15px -3px rgba(0, 0, 0, 0.1),
            0 4px 6px -2px rgba(0, 0, 0, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.3)
          `
        }}
      >
        <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white text-center py-4 px-4">
          <h3 className="font-bold text-lg uppercase tracking-wide">{month}</h3>
        </div>
        <div className="p-6 flex-1 flex flex-col">
          {data.theme && (
            <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200/50">
              <p className="text-sm font-semibold text-blue-800 text-center italic">
                {data.theme}
              </p>
            </div>
          )}
          <div className="space-y-3 mb-6 flex-1">
            {/* Initial 5 holidays - always visible */}
            {initialHolidays.map((holiday, idx) => (
              <HolidayItem 
                key={`initial-${monthKey}-${idx}`} 
                holiday={holiday} 
                idx={idx} 
                monthKey={monthKey}
                getTypeColor={getTypeColor}
              />
            ))}
            
            {/* Additional holidays - animated expand/collapse */}
            <AnimatePresence>
              {isExpanded && hasMoreHolidays && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ 
                    duration: 0.5,
                    ease: "easeInOut"
                  }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 pt-2 border-t border-gray-100">
                    {additionalHolidays.map((holiday, idx) => (
                      <HolidayItem 
                        key={`additional-${monthKey}-${idx}`} 
                        holiday={holiday} 
                        idx={idx} 
                        isAdditional={true}
                        monthKey={monthKey}
                        getTypeColor={getTypeColor}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {hasMoreHolidays && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center pt-2"
              >
                <motion.button
                  onClick={() => onToggleExpansion(monthKey)}
                  className="flex items-center justify-center gap-2 mx-auto px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all duration-200"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span>{isExpanded ? 'Show Less' : `+${data.holidays.length - 5} more holidays`}</span>
                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </motion.div>
                </motion.button>
              </motion.div>
            )}
          </div>
          <div className="mt-auto pt-6">
            <button
              onClick={handleMonthClick}
              className="w-full bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
            >
              <span>View Calendar</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Monthly Calendar Modal */}
      <MonthlyCalendarModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        month={month}
        monthKey={monthKey}
        data={data}
      />
    </>
  );
});

MonthCard.displayName = 'MonthCard';

const EcommerceHolidaysCalendar = () => {
  const [expandedMonths, setExpandedMonths] = useState({});

  const holidayData = {
    january: {
      theme: null,
      holidays: [
        { day: 1, name: "New Year's Day", type: "holiday" },
        { day: 11, name: "Human Trafficking Awareness Day", type: "awareness" },
        { day: 13, name: "National Sticker Day", type: "other" },
        { day: 15, name: "National Hat Day", type: "other" },
        { day: 20, name: "Martin Luther King Jr. Day", type: "holiday", flag: "🇺🇸" },
        { day: 21, name: "National Cheesy Socks Day", type: "other" },
        { day: 26, name: "Get to Know Your Customers Day", type: "other" },
        { day: 26, name: "Australia Day", type: "holiday", flag: "🇦🇺" },
        { day: 29, name: "Chinese New Year", type: "holiday", flag: "🇨🇳" }
      ]
    },
    february: {
      theme: "Black History Month",
      holidays: [
        { day: 2, name: "Groundhog Day", type: "holiday", flag: "🇺🇸" },
        { day: 4, name: "World Cancer Day", type: "awareness" },
        { day: 4, name: "Safer internet day", type: "awareness" },
        { day: 9, name: "Super Bowl Sunday", type: "sports", flag: "🇺🇸" },
        { day: 14, name: "Valentine's Day", type: "holiday" },
        { day: 19, name: "Presidents' Day", type: "holiday", flag: "🇺🇸" },
        { day: 25, name: "World Spay Day", type: "awareness" }
      ]
    },
    march: {
      theme: "Women's History Month",
      holidays: [
        { day: 6, name: "National Dress Day", type: "other" },
        { day: 8, name: "International Women's Day", type: "awareness" },
        { day: 14, name: "Holi Festival", type: "holiday", flag: "🇮🇳" },
        { day: 17, name: "St. Patrick's Day", type: "holiday", flag: "🇺🇸 🇮🇪 🇨🇦 🍀" },
        { day: 19, name: "Holy Saturday", type: "holiday" },
        { day: 20, name: "First day of Spring", type: "other" },
        { day: 30, name: "Easter Sunday", type: "holiday" },
        { day: 30, name: "Mother's Day", type: "holiday", flag: "🇬🇧" }
      ]
    },
    april: {
      theme: null,
      holidays: [
        { day: 1, name: "April Fools' Day", type: "holiday" },
        { day: 10, name: "National Sibling Day", type: "other" },
        { day: 11, name: "National Pet Day", type: "other" },
        { day: 11, name: "Coachella Festival", type: "other" },
        { day: 17, name: "Get to Know Your Customers Day", type: "other" },
        { day: 18, name: "Coachella Festival", type: "other" },
        { day: 20, name: "Easter Sunday", type: "holiday" },
        { day: 22, name: "Earth Day", type: "awareness" },
        { day: 23, name: "World Book Day", type: "awareness" },
        { day: 29, name: "International Dance Day", type: "awareness" },
        { day: 30, name: "Honesty Day", type: "awareness" }
      ]
    },
    may: {
      theme: "Mental Health Awareness Month",
      holidays: [
        { day: 3, name: "Space Day", type: "other" },
        { day: 5, name: "Cinco de Mayo", type: "holiday" },
        { day: 11, name: "Mothers' Day", type: "holiday", flag: "🇺🇸 🇨🇦 🇦🇺 🇳🇿" },
        { day: 16, name: "National Love a Tree Day", type: "other" },
        { day: 19, name: "Victoria Day", type: "holiday", flag: "🇨🇦" },
        { day: 26, name: "Memorial Day", type: "holiday", flag: "🇺🇸" },
        { day: 28, name: "National Flip Flop Day", type: "other" }
      ]
    },
    june: {
      theme: "Pride Month",
      holidays: [
        { day: 5, name: "World Environment Day", type: "awareness" },
        { day: 6, name: "National Doughnut Day", type: "other", flag: "🇺🇸" },
        { day: 14, name: "American Flag Day", type: "holiday", flag: "🇺🇸" },
        { day: 15, name: "Father's Day", type: "holiday", flag: "🇺🇸 🇬🇧 🇨🇦" },
        { day: 21, name: "First Day of Summer", type: "other" },
        { day: 21, name: "International Yoga Day", type: "awareness" }
      ]
    },
    july: {
      theme: null,
      holidays: [
        { day: 1, name: "Canada Day", type: "holiday", flag: "🇨🇦" },
        { day: 4, name: "Independence Day", type: "holiday", flag: "🇺🇸" },
        { day: 5, name: "National Bikini Day", type: "other", flag: "🇺🇸" },
        { day: 17, name: "World Emoji Day", type: "other" },
        { day: 17, name: "Get to Know Your Customers Day", type: "other" },
        { day: 30, name: "International Day of Friendship", type: "awareness" }
      ]
    },
    august: {
      theme: "Back-to-school season",
      holidays: [
        { day: 3, name: "American Family Day", type: "other" },
        { day: 9, name: "National Book Lovers Day", type: "other" },
        { day: 7, name: "National Nonprofit Day", type: "awareness", flag: "🇬🇧" },
        { day: 19, name: "World Photography Day", type: "awareness" }
      ]
    },
    september: {
      theme: "National Hispanic Heritage Month",
      holidays: [
        { day: 1, name: "Labor Day", type: "holiday", flag: "🇺🇸 🇨🇦" },
        { day: 7, name: "Father's Day", type: "holiday", flag: "🇦🇺" },
        { day: 20, name: "Oktoberfest (Sept 20–Oct 5)", type: "other", flag: "🇩🇪 🍺" },
        { day: 21, name: "International Day of Peace", type: "awareness" },
        { day: 22, name: "First Day of Fall", type: "other" }
      ]
    },
    october: {
      theme: null,
      holidays: [
        { day: 5, name: "World Teachers' Day", type: "awareness" },
        { day: 10, name: "World Mental Health Day", type: "awareness" },
        { day: 14, name: "Thanksgiving", type: "holiday", flag: "🇨🇦" },
        { day: 16, name: "Boss's Day", type: "other" },
        { day: 17, name: "Get to Know Your Customers Day", type: "other" },
        { day: 20, name: "Diwali", type: "holiday", flag: "🇮🇳" },
        { day: 31, name: "Halloween", type: "holiday" }
      ]
    },
    november: {
      theme: "National Native American Heritage Month",
      holidays: [
        { day: 1, name: "World Vegan Day", type: "awareness" },
        { day: 11, name: "Remembrance Day", type: "holiday", flag: "🇺🇸" },
        { day: 11, name: "Single's Day", type: "holiday", flag: "🇨🇳" },
        { day: 27, name: "Thanksgiving", type: "holiday" },
        { day: 28, name: "Black Friday", type: "holiday", flag: "🇺🇸" }
      ]
    },
    december: {
      theme: null,
      holidays: [
        { day: 1, name: "Cyber Monday", type: "holiday" },
        { day: 4, name: "National Sock Day", type: "other" },
        { day: 8, name: "Green Monday", type: "other" },
        { day: 14, name: "Hanukkah (Oct 14–Oct 22)", type: "holiday" },
        { day: 14, name: "National Free Shipping Day", type: "other" },
        { day: 24, name: "Christmas Eve", type: "holiday" },
        { day: 25, name: "Christmas Day", type: "holiday" },
        { day: 26, name: "Boxing Day", type: "holiday", flag: "🇬🇧 🇨🇦" },
        { day: 26, name: "Kwanzaa (Dec 26–Jan 1)", type: "other" },
        { day: 31, name: "New Year's Eve", type: "holiday" }
      ]
    }
  };

  // Memoize the toggle function to prevent unnecessary re-renders
  const toggleMonthExpansion = useCallback((monthKey) => {
    setExpandedMonths(prev => ({
      ...prev,
      [monthKey]: !prev[monthKey]
    }));
  }, []);

  const months = [
    { month: "January", monthKey: "january", data: holidayData.january, index: 0 },
    { month: "February", monthKey: "february", data: holidayData.february, index: 1 },
    { month: "March", monthKey: "march", data: holidayData.march, index: 2 },
    { month: "April", monthKey: "april", data: holidayData.april, index: 3 },
    { month: "May", monthKey: "may", data: holidayData.may, index: 4 },
    { month: "June", monthKey: "june", data: holidayData.june, index: 5 },
    { month: "July", monthKey: "july", data: holidayData.july, index: 6 },
    { month: "August", monthKey: "august", data: holidayData.august, index: 7 },
    { month: "September", monthKey: "september", data: holidayData.september, index: 8 },
    { month: "October", monthKey: "october", data: holidayData.october, index: 9 },
    { month: "November", monthKey: "november", data: holidayData.november, index: 10 },
    { month: "December", monthKey: "december", data: holidayData.december, index: 11 }
  ];

    return (
    <div className="min-h-screen bg-gray-50/50 lg:mt-0 mt-[12vh]">
      {/* Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>Ecommerce Calendar</h1>
                <p className='text-sm text-gray-600 mt-1'>Plan your marketing campaigns around key ecommerce holidays and events</p>
        </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium'>
                <Calendar className='w-2 h-2' />
                2025 Calendar
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          {/* Calendar Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
            {months.map(({ month, monthKey, data, index }) => (
              <MonthCard
                key={monthKey}
                month={month}
                monthKey={monthKey}
                data={data}
                index={index}
                isExpanded={expandedMonths[monthKey] || false}
                onToggleExpansion={toggleMonthExpansion}
              />
            ))}
        </div>
        
          {/* Legend */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.2 }}
            className="bg-gradient-to-br from-white to-gray-50/50 rounded-xl shadow-lg border border-gray-200/80 p-6"
            style={{
              boxShadow: `
                0 10px 15px -3px rgba(0, 0, 0, 0.1),
                0 4px 6px -2px rgba(0, 0, 0, 0.05),
                inset 0 1px 0 rgba(255, 255, 255, 0.3)
              `
            }}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Event Types</h3>
            <div className="flex flex-wrap justify-center items-center gap-6">
          <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded-full shadow-sm"></div>
                <span className="text-sm font-medium text-gray-700">Holiday</span>
          </div>
          <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded-full shadow-sm"></div>
                <span className="text-sm font-medium text-gray-700">Sports</span>
          </div>
          <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-purple-500 rounded-full shadow-sm"></div>
                <span className="text-sm font-medium text-gray-700">Awareness</span>
          </div>
          <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded-full shadow-sm"></div>
                <span className="text-sm font-medium text-gray-700">Other</span>
              </div>
          </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default EcommerceHolidaysCalendar;