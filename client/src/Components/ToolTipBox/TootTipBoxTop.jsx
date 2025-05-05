import React from 'react';

const TooltipBox = ({ Information }) => {
    return (
        <div className="absolute bottom-[170%] left-1/2 transform -translate-x-1/2 z-50">
  <div className="relative w-[20rem] overflow-visible">
    {/* Tooltip Box */}
    <div className="relative bg-[rgb(31,41,55)]  text-white text-sm p-3 rounded-xl shadow-lg z-20">
      <p>{Information}</p>
    </div>

    {/* Arrow */}
    <div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-[rgb(31,41,55)]  rotate-45 z-10"></div>
  </div>
</div>

    );
};

export default TooltipBox;
