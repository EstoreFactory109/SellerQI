
import axios from 'axios';
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import { setHistoryInfo } from '../redux/slices/HistorySlice.js';
import { loginSuccess } from '../redux/slices/authSlice.js';
import { updateImageLink } from '../redux/slices/profileImage.js';
import analyseData from './analyse.js';


const fetchData = async (dispatch) => {

    try {
        const response = await axios.get(
            `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`, { withCredentials: true }
        );

        let dashboardData = null;
        if (response?.status === 200 && response.data?.data) {
            console.log
            dashboardData = analyseData(response.data.data).dashboardData;
            dispatch(setDashboardInfo(dashboardData));
        }

        const historyResponse = await axios.get(
            `${import.meta.env.VITE_BASE_URI}/app/accountHistory/getAccountHistory`,
            { withCredentials: true }
        );

        if (historyResponse?.status === 200 && historyResponse.data?.data) {
            const currentDate = new Date();
            const expireDate = new Date();
            expireDate.setDate(currentDate.getDate() + 7);

            if (currentDate > new Date(historyResponse.data.data[historyResponse.data.data.length - 1].expireDate)) {
                const HistoryData = {
                    Date: currentDate,
                    HealthScore: dashboardData.accountHealthPercentage.Percentage,
                    TotalProducts: dashboardData.TotalProduct.length,
                    ProductsWithIssues: dashboardData.productWiseError.length,
                    TotalNumberOfIssues: dashboardData.TotalRankingerrors + dashboardData.totalErrorInConversion + dashboardData.totalErrorInAccount,
                    expireDate: expireDate
                };

                const UpdateHistory = await axios.post(
                    `${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`,
                    HistoryData,
                    { withCredentials: true }
                );

                if (UpdateHistory?.status === 200 && UpdateHistory.data?.data) {
                    dispatch(setHistoryInfo(UpdateHistory.data.data));
                }
            } else {
                dispatch(setHistoryInfo(historyResponse.data.data));
            }
        }
    } catch (error) {
        console.error('❌ Error while fetching data:', error);
    }
};



export default fetchData;
