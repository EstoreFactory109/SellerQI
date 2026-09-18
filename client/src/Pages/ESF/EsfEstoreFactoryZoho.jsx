import React from 'react';
import EsfZohoIntegration from '../../Components/ESF/EsfZohoIntegration.jsx';

/**
 * "Estore Factory" section > Zoho Projects.
 *
 * A top-level page (not a Settings tab) for internal eStore Factory tools —
 * distinct from client-facing pages and from the staff member's own account
 * settings. The page title comes from PAGE_TITLES in EsfLayout, matching how
 * EsfClients/EsfUsers work, so no local heading is rendered here.
 */
const EsfEstoreFactoryZoho = () => (
  <div className="relative min-h-full w-full overflow-hidden bg-[#0b0f17] p-4 md:p-6">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%)]" />
    <div className="relative max-w-[1600px] w-full">
      <EsfZohoIntegration />
    </div>
  </div>
);

export default EsfEstoreFactoryZoho;
