import ActivityList from '../../Components/Activity/ActivityList.jsx';
import ActivityDetail from '../../Components/Activity/ActivityDetail.jsx';

// ESF portal: how ESF clients use SellerQI (owner/admin only; server: /app/esf/activity).
const API = '/app/esf/activity';

export const EsfClientActivityDetail = () => (
  <ActivityDetail apiBase={API} backPath="/esf/activity" backLabel="All clients" />
);

const EsfClientActivity = () => (
  <ActivityList
    apiBase={API}
    detailPath={(userId) => `/esf/activity/${userId}`}
    emptyHint="Activity is recorded from the moment this feature went live."
  />
);

export default EsfClientActivity;
