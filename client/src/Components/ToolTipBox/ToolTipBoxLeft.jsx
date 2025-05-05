import React from 'react';

const TooltipBox = ({ Information }) => {
  return (
    <div className="absolute bottom-full mb-2 left-0 z-50">
      <div className="relative w-[20rem]">
        {/* Tooltip Box */}
        <div className="relative bg-[rgb(31,41,55)] text-white text-sm p-3 rounded-xl shadow-lg z-20">
          <p>{Information}</p>

          {/* Arrow at bottom-left, slightly inside box */}
          <div className="absolute -bottom-1 left-2 w-3 h-3 bg-[rgb(31,41,55)] rotate-[51deg] z-10"></div>
        </div>
      </div>
    </div>
  );
};

export default TooltipBox;
