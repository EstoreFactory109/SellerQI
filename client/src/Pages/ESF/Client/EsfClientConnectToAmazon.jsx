import React from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import ConnectToAmazon from '../../Onboarding/ConnectToAmazon.jsx';

const EsfClientConnectToAmazon = () => {
  const { clientId } = useParams();
  const context = useOutletContext();
  const id = context?.clientId ?? clientId;

  return (
    <ConnectToAmazon
      isAgencyContext
      clientId={id}
      basePath={context?.basePath ?? `/esf/client/${id}`}
    />
  );
};

export default EsfClientConnectToAmazon;
