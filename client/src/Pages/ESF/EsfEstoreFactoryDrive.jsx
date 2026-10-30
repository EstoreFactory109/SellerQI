import React from 'react';
import EsfDriveIntegration from '../../Components/ESF/EsfDriveIntegration.jsx';

/** "Estore Factory" section > Google Drive. Same frame as EsfEstoreFactoryZoho. */
const EsfEstoreFactoryDrive = () => (
  <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />
    <div className="relative max-w-[1600px] w-full">
      <EsfDriveIntegration />
    </div>
  </div>
);

export default EsfEstoreFactoryDrive;
