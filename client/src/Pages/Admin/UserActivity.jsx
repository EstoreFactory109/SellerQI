import ActivityList from '../../Components/Activity/ActivityList.jsx';
import ActivityDetail from '../../Components/Activity/ActivityDetail.jsx';

// Super admin: how every seller uses SellerQI (server: /app/auth/admin/activity).
const API = '/app/auth/admin/activity';

export const UserActivityDetail = () => (
  <ActivityDetail apiBase={API} backPath="/manage-accounts/activity" backLabel="All users" />
);

const UserActivity = () => (
  <ActivityList
    apiBase={API}
    detailPath={(userId) => `/manage-accounts/activity/${userId}`}
    emptyHint="Activity is recorded from the moment this feature went live."
  />
);

export default UserActivity;
