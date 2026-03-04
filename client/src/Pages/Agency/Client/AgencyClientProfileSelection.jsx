import React from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ProfileIDSelection from '../../Onboarding/ProfileIDSeclection.jsx';

const AgencyClientProfileSelection = () => {
  const { agencyName, clientId } = useParams();
  const context = useOutletContext();
  const displayAgency = context?.agencyName ?? (agencyName ? decodeURIComponent(agencyName) : '');
  const displayClientId = context?.clientId ?? clientId;

  return (
    <ProfileIDSelection
      isAgencyContext
      clientId={displayClientId}
      agencyName={displayAgency}
    />
  );
};

export default AgencyClientProfileSelection;
