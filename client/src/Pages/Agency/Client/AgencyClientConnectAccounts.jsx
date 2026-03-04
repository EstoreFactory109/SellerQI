import React from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ConnectAccounts from '../../Onboarding/ConnectAccounts.jsx';

const AgencyClientConnectAccounts = () => {
  const { agencyName, clientId } = useParams();
  const context = useOutletContext();
  const displayAgency = context?.agencyName ?? (agencyName ? decodeURIComponent(agencyName) : '');
  const displayClientId = context?.clientId ?? clientId;

  return (
    <ConnectAccounts
      isAgencyContext
      clientId={displayClientId}
      agencyName={displayAgency}
    />
  );
};

export default AgencyClientConnectAccounts;
