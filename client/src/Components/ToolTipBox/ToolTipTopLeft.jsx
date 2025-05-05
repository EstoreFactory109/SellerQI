import React from 'react';

const TooltipBox = ({ Information }) => {
  return (
    <div className="absolute bottom-[150%] -left-1 z-50">
      <div className="relative w-[18rem]">
        {/* Tooltip Box */}
        <div className="relative bg-[rgb(31,41,55)] text-white text-sm p-3 rounded-xl shadow-lg z-20">
          <p>{Information}</p>

          {/* Arrow aligned to top-right inside box, pointing down to icon */}
          <div className="absolute -bottom-1 left-1.5 w-3 h-3 bg-[rgb(31,41,55)] rotate-[-40deg] z-10"></div>
        </div>
      </div>
    </div>
  );
};

export default TooltipBox;
