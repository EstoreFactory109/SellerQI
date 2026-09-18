import React from 'react';
import AgencyProfileIDSelectionPage from '../../Agency/Client/AgencyProfileIDSelectionPage.jsx';

// Reuses the agency profile-selection screen, returning to the ESF client list
// instead of the agency "analysing account" page.
const EsfClientProfileSelection = () => {
  return <AgencyProfileIDSelectionPage analysingPath="/esf/clients" />;
};

export default EsfClientProfileSelection;
