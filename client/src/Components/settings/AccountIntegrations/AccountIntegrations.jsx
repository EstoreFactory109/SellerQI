import React,{useState, useEffect} from "react";
import { useNavigate } from "react-router-dom";
import AmazonConnectPopup from "./AmazonConnectPopup";
import { Link, Plus, Globe, ShoppingBag, MapPin, Building, CheckCircle, AlertCircle, Zap, Trash2, ChevronDown } from "lucide-react";
import axiosInstance from "../../../config/axios.config";

export default function AccountCards() {

  const [open,setOpen]=useState(false)
  const [selectedActions, setSelectedActions] = useState({});
  const [openDropdowns, setOpenDropdowns] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate()
  console.log(accounts)

  // Always fetch latest accounts directly from the database for this page
  useEffect(() => {
    let isMounted = true;

    const fetchAccounts = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await axiosInstance.get("/app/token/seller-accounts");
        if (!isMounted) return;

        const fetched =
          response?.data?.data?.accounts && Array.isArray(response.data.data.accounts)
            ? response.data.data.accounts
            : [];

        setAccounts(fetched);
      } catch (err) {
        if (!isMounted) return;
        console.error("Error fetching seller accounts for Account Integrations:", err);
        setError(
          err?.response?.data?.message ||
          "Failed to load accounts. Please refresh the page."
        );
        setAccounts([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchAccounts();

    return () => {
      isMounted = false;
    };
  }, []);

  // Function to get status info based on token status
  const getConnectionStatus = (spApiStatus, adsApiStatus) => {
    if (spApiStatus && adsApiStatus) {
      return {
        text: "Connected",
        color: "text-emerald-700",
        bgColor: "bg-emerald-50",
        dotColor: "bg-emerald-500",
        icon: <CheckCircle className="w-3 h-3" />
      }
    } else if (spApiStatus && !adsApiStatus) {
      return {
        text: "Seller Central Connected",
        color: "text-blue-700",
        bgColor: "bg-blue-50",
        dotColor: "bg-blue-500",
        icon: <AlertCircle className="w-3 h-3" />
      }
    } else if (!spApiStatus && adsApiStatus) {
      return {
        text: "Ads Account Connected",
        color: "text-orange-700",
        bgColor: "bg-orange-50",
        dotColor: "bg-orange-500",
        icon: <AlertCircle className="w-3 h-3" />
      }
    } else {
      return {
        text: "Not Connected",
        color: "text-red-700",
        bgColor: "bg-red-50",
        dotColor: "bg-red-500",
        icon: <AlertCircle className="w-3 h-3" />
      }
    }
  }

  // Function to get the appropriate button configuration
  const getConnectButton = (spApiStatus, adsApiStatus) => {
    if (spApiStatus && adsApiStatus) {
      return null; // No button needed when fully connected
    } else if (spApiStatus && !adsApiStatus) {
      return {
        text: "Connect Ads Account",
        color: "bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800",
        icon: <Zap className="w-4 h-4" />
      }
    } else if (!spApiStatus && adsApiStatus) {
      return {
        text: "Connect Seller Central",
        color: "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800",
        icon: <ShoppingBag className="w-4 h-4" />
      }
    } else {
      return {
        text: "Connect to Amazon",
        color: "bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800",
        icon: <Plus className="w-4 h-4" />
      }
    }
  }

  const handleConnectAccount = (country, region, spApiConnected = false) => {
    const params = new URLSearchParams({
      country: country || '',
      region: region || ''
    });
    if (spApiConnected) {
      params.append('spApiConnected', 'true');
    }
    navigate(`/connect-accounts?${params.toString()}`)
  }
  const handleApplyAction = async (account) => {
    const action = selectedActions[account._id] || 'removeAll';

    try {
      // These endpoints are mounted under /app/token and use IBEXLocationToken
      // (country/region) to determine which seller account to act on.
      if (action === 'removeAll') {
        await axiosInstance.delete('/app/token/deleteAllSellerRefreshTokens');
      } else if (action === 'removeAds') {
        await axiosInstance.delete('/app/token/deleteAdsRefreshToken');
      }

      setOpenDropdowns(prev => ({
        ...prev,
        [account._id]: false
      }));

      // Reload to refresh integration statuses without touching other state
      window.location.reload();
    } catch (error) {
      console.error('Error applying account action:', error);
      alert(
        error?.response?.data?.message ||
        'Failed to update account tokens. Please try again.'
      );
    }
  };

  const handleAddAccount = (e) => {
    e.preventDefault();
    setOpen(true);
  };

  const closeAddAccount=(e)=>{
    e.preventDefault();
    setOpen(false);
  }

  return (
    <>
    {open &&<AmazonConnectPopup closeAddAccount={closeAddAccount}/>}
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 px-6 py-8 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                <div className="flex items-center gap-3">
                  <Link className="w-6 h-6 text-white" />
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Account Integrations
                  </h2>
                </div>
              </div>
              <p className="text-gray-300 text-sm">Connect and manage your Amazon seller accounts</p>
            </div>
            
            <button
              onClick={handleAddAccount}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Plus className="w-5 h-5" />
              Add New Account
            </button>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-600">
            Loading your Amazon accounts...
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-600">
            {error}
          </div>
        ) : accounts && accounts.length > 0 ? (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
            {accounts.map((account, index) => {
              const statusInfo = getConnectionStatus(account.SpAPIrefreshTokenStatus, account.AdsAPIrefreshTokenStatus)
              const buttonInfo = getConnectButton(account.SpAPIrefreshTokenStatus, account.AdsAPIrefreshTokenStatus)
              
              return (
                <div
                  key={index}
                  className="group bg-white border border-gray-200/80 rounded-2xl p-6 hover:border-gray-300 hover:shadow-lg transition-all duration-300 relative overflow-hidden min-w-[350px]"
                >
                  {/* Gradient accent */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600"></div>
                  
                  {/* Platform header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg">
                        <ShoppingBag className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Amazon</h3>
                        <p className="text-sm text-gray-600">{account.brand || 'Amazon Seller'}</p>
                      </div>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDropdowns(prev => ({
                            ...prev,
                            [account._id]: !prev[account._id]
                          }))
                        }
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-800 bg-white border border-gray-200 rounded-full shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-150"
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                        <span>
                          {selectedActions[account._id] === 'removeAds'
                            ? 'Remove Ads account'
                            : 'Remove all integrations'}
                        </span>
                        <ChevronDown className="w-3 h-3 text-gray-500" />
                      </button>

                      {openDropdowns[account._id] && (
                        <div className="absolute right-0 mt-2 w-60 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-2">
                          <p className="px-3 pb-2 text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                            Account actions
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedActions(prev => ({
                                ...prev,
                                [account._id]: 'removeAll'
                              }))
                            }
                            className={`flex w-full items-start gap-2 px-3 py-2 text-xs text-left hover:bg-red-50 ${
                              (selectedActions[account._id] || 'removeAll') === 'removeAll'
                                ? 'bg-red-50 text-red-700'
                                : 'text-gray-700'
                            }`}
                          >
                            <span className="mt-0.5 h-4 w-4 rounded-full border border-red-300 flex items-center justify-center">
                              {(selectedActions[account._id] || 'removeAll') === 'removeAll' && (
                                <span className="h-2 w-2 rounded-full bg-red-500" />
                              )}
                            </span>
                            <div>
                              <div className="font-semibold">Remove all integrations</div>
                              <div className="text-[11px] text-gray-500">
                                Disconnect both Seller Central and Ads for this account.
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedActions(prev => ({
                                ...prev,
                                [account._id]: 'removeAds'
                              }))
                            }
                            className={`flex w-full items-start gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 ${
                              selectedActions[account._id] === 'removeAds'
                                ? 'bg-gray-50 text-gray-800'
                                : 'text-gray-700'
                            }`}
                          >
                            <span className="mt-0.5 h-4 w-4 rounded-full border border-gray-300 flex items-center justify-center">
                              {selectedActions[account._id] === 'removeAds' && (
                                <span className="h-2 w-2 rounded-full bg-gray-600" />
                              )}
                            </span>
                            <div>
                              <div className="font-semibold">Remove Ads account</div>
                              <div className="text-[11px] text-gray-500">
                                Keep Seller Central connected and only remove Ads.
                              </div>
                            </div>
                          </button>

                          <div className="border-t border-gray-100 mt-2 pt-2 px-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleApplyAction(account)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 rounded-full shadow-sm hover:shadow-md transition-all duration-150"
                            >
                              <Trash2 className="w-3 h-3" />
                              Apply
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Connection Statuses */}
                  <div className="space-y-2 mb-4">
                    {/* Seller Account Status */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                      account.SpAPIrefreshTokenStatus 
                        ? 'bg-emerald-50 text-emerald-700' 
                        : 'bg-red-50 text-red-700'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        account.SpAPIrefreshTokenStatus ? 'bg-emerald-500' : 'bg-red-500'
                      }`}></div>
                      {account.SpAPIrefreshTokenStatus ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <AlertCircle className="w-3 h-3" />
                      )}
                      <span className="whitespace-nowrap">
                        {account.SpAPIrefreshTokenStatus ? 'Seller Account Connected' : 'Seller Account Not Connected'}
                      </span>
                    </div>

                    {/* Ads Account Status */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                      account.AdsAPIrefreshTokenStatus 
                        ? 'bg-emerald-50 text-emerald-700' 
                        : 'bg-red-50 text-red-700'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        account.AdsAPIrefreshTokenStatus ? 'bg-emerald-500' : 'bg-red-500'
                      }`}></div>
                      {account.AdsAPIrefreshTokenStatus ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <AlertCircle className="w-3 h-3" />
                      )}
                      <span className="whitespace-nowrap">
                        {account.AdsAPIrefreshTokenStatus ? 'Ads Account Connected' : 'Ads Account Not Connected'}
                      </span>
                    </div>
                  </div>

                  {/* Account details */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <Building className="w-4 h-4 text-gray-500" />
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Brand</p>
                        <p className="text-sm font-semibold text-gray-900">{account?.brand || 'Not specified'}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <Globe className="w-4 h-4 text-gray-500" />
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Region</p>
                        <p className="text-sm font-semibold text-gray-900">{account?.region || 'Not specified'}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <MapPin className="w-4 h-4 text-gray-500" />
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Marketplace</p>
                        <p className="text-sm font-semibold text-gray-900">{account?.country || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Connection Button */}
                  {buttonInfo && (
                    <div className="mt-6 pt-4 border-t border-gray-200/80">
                      <button
                        onClick={() => handleConnectAccount(account.country, account.region, account.SpAPIrefreshTokenStatus)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-white rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl font-medium text-sm whitespace-nowrap ${buttonInfo.color}`}
                      >
                        {buttonInfo.icon}
                        {buttonInfo.text}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Link className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No accounts connected</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Connect your Amazon seller account to start analyzing your business performance and get insights.
            </p>
            <button
              onClick={() => handleConnectAccount('', '')}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl mx-auto"
            >
              <Plus className="w-5 h-5" />
              Connect Your First Account
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
