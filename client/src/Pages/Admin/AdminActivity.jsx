import React from 'react';
import ActivityOverview from '../../Components/Activity/ActivityOverview.jsx';

/** Super admin → User activity: every seller who is active now or was recently. */
const AdminActivity = () => (
  <ActivityOverview
    overviewUrl="/app/auth/admin/activity"
    timelineUrlFor={(userId) => `/app/auth/admin/activity/users/${userId}`}
    subjectLabel="sellers"
  />
);

export default AdminActivity;
