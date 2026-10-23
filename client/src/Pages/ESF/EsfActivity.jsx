import React from 'react';
import ActivityOverview from '../../Components/Activity/ActivityOverview.jsx';
import { useEsfUser } from '../../contexts/EsfUserContext.js';
import { canViewClientActivity } from '../../utils/esfActivityAccess.js';

/** ESF portal → Client activity (owner and admins; the server enforces it too). */
const EsfActivity = () => {
  const esfUser = useEsfUser();
  if (!canViewClientActivity(esfUser)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#101722]/90 p-8 text-center text-sm text-gray-400">
        Only the portal owner and admins can see client activity.
      </div>
    );
  }
  return (
    <ActivityOverview
      overviewUrl="/app/esf/activity"
      timelineUrlFor={(clientId) => `/app/esf/activity/clients/${clientId}`}
      subjectLabel="clients"
    />
  );
};

export default EsfActivity;
