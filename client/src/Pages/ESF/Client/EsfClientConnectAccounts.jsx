import React from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ConnectAccounts from '../../Onboarding/ConnectAccounts.jsx';

const EsfClientConnectAccounts = () => {
  const { clientId } = useParams();
  const context = useOutletContext();
  const id = context?.clientId ?? clientId;

  return (
    <ConnectAccounts
      isAgencyContext
      clientId={id}
      basePath={context?.basePath ?? `/esf/client/${id}`}
    />
  );
};

export default EsfClientConnectAccounts;
