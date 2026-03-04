import React from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ConnectToAmazon from '../../Onboarding/ConnectToAmazon.jsx';

const AgencyClientConnectToAmazon = () => {
  const { agencyName, clientId } = useParams();
  const context = useOutletContext();
  const displayAgency = context?.agencyName ?? (agencyName ? decodeURIComponent(agencyName) : '');
  const displayClientId = context?.clientId ?? clientId;

  return (
    <ConnectToAmazon
      isAgencyContext
      clientId={displayClientId}
      agencyName={displayAgency}
    />
  );
};

export default AgencyClientConnectToAmazon;
