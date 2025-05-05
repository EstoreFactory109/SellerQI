import React from 'react';

const TooltipBox = ({ Information }) => {
  return (
    <div className="absolute top-[150%] mt-2 left-1/2 transform -translate-x-1/2 z-50">
      {/* Arrow */}
      <div className="absolute -top-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-[rgb(31,41,55)]  rotate-45 z-10"></div>
      
      {/* Tooltip Box */}
      <div className="min-w-[20rem] bg-[rgb(31,41,55)]  text-white text-sm p-3 rounded-xl max-w-xs shadow-lg relative z-20 ">
        <p>{Information}</p>
      </div>
    </div>
  );
};

export default TooltipBox;
