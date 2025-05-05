import React from 'react';

const TooltipBox = ({ Information }) => {
  return (
    <div className="absolute top-[150%] mt-2 -right-2 z-50">
      {/* Arrow pointing up, at the extreme left */}
      <div className="absolute -top-1 right-2 w-3 h-3 bg-[rgb(31,41,55)] rotate-[45deg] z-10"></div>

      {/* Tooltip Box */}
      <div className="min-w-[20rem] bg-[rgb(31,41,55)] text-white text-sm p-3 rounded-xl shadow-lg relative z-20">
        <p>{Information}</p>
      </div>
    </div>
  );
};

export default TooltipBox;
