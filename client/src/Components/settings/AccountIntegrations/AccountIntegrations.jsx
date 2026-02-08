import React,{useState, useEffect} from "react";
import { useNavigate } from "react-router-dom";
import AmazonConnectPopup from "./AmazonConnectPopup";
import { Link, Plus, Globe, ShoppingBag, MapPin, Building, CheckCircle, AlertCircle, Zap, Trash2 } from "lucide-react";
import axiosInstance from "../../../config/axios.config";

export default function AccountCards() {

  const [open,setOpen]=useState(false)
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
        color: "bg-orange-600 hover:bg-orange-700",
        icon: <Zap className="w-4 h-4" />
      }
    } else if (!spApiStatus && adsApiStatus) {
      return {
        text: "Connect Seller Central",
        color: "bg-blue-600 hover:bg-blue-700",
        icon: <ShoppingBag className="w-4 h-4" />
      }
    } else {
      return {
        text: "Connect to Amazon",
        color: "bg-purple-600 hover:bg-purple-700",
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
  const handleRemoveAllIntegrations = async () => {
    try {
      // These endpoints are mounted under /app/token and use IBEXLocationToken
      // (country/region) to determine which seller account to act on.
      await axiosInstance.delete('/app/token/deleteAllSellerRefreshTokens');

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
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      {/* Header Section */}
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-2 h-6 bg-blue-400 rounded-full"></div>
                <div className="flex items-center gap-3">
                  <Link className="w-5 h-5 text-white" />
                  <h2 className="text-xl font-bold text-white">
                    Account Integrations
                  </h2>
                </div>
              </div>
              <p className="text-gray-200 text-xs">Connect and manage your Amazon seller accounts</p>
            </div>
            
            <button
              onClick={handleAddAccount}
              className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white font-medium rounded-xl hover:bg-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Plus className="w-4 h-4" />
              Add New Account
            </button>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-4">
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">
            Loading your Amazon accounts...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-400">
            {error}
          </div>
        ) : accounts && accounts.length > 0 ? (
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
            {accounts.map((account, index) => {
              const statusInfo = getConnectionStatus(account.SpAPIrefreshTokenStatus, account.AdsAPIrefreshTokenStatus)
              const buttonInfo = getConnectButton(account.SpAPIrefreshTokenStatus, account.AdsAPIrefreshTokenStatus)
              
              return (
                <div
                  key={index}
                  className="group bg-[#1a1a1a] border border-[#30363d] rounded-2xl p-4 hover:border-[#21262d] hover:shadow-lg transition-all duration-300 relative overflow-hidden min-w-[350px]"
                >
                  {/* Gradient accent */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-blue-600"></div>
                  
                  {/* Platform header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg">
                        <ShoppingBag className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-gray-100">Amazon</h3>
                        <p className="text-xs text-gray-400">{account.brand || 'Amazon Seller'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveAllIntegrations}
                      className="inline-flex items-center gap-2 px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-full shadow-sm hover:shadow-md transition-all duration-150"
                      title="Disconnect Seller Central and Ads for this account"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove integrations
                    </button>
                  </div>

                  {/* Individual Connection Statuses */}
                  <div className="space-y-2 mb-3">
                    {/* Seller Account Status */}
                    <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                      account.SpAPIrefreshTokenStatus 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/40' 
                        : 'bg-red-500/10 text-red-400 border border-red-500/40'
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
                    <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                      account.AdsAPIrefreshTokenStatus 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/40' 
                        : 'bg-red-500/10 text-red-400 border border-red-500/40'
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
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-2 bg-[#161b22] rounded-xl border border-[#30363d]">
                      <Building className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Brand</p>
                        <p className="text-sm font-semibold text-gray-100">{account?.brand || 'Not specified'}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-2 bg-[#161b22] rounded-xl border border-[#30363d]">
                      <Globe className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Region</p>
                        <p className="text-sm font-semibold text-gray-100">{account?.region || 'Not specified'}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-2 bg-[#161b22] rounded-xl border border-[#30363d]">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Marketplace</p>
                        <p className="text-sm font-semibold text-gray-100">{account?.country || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Connection Button */}
                  {buttonInfo && (
                    <div className="mt-4 pt-3 border-t border-[#30363d]">
                      <button
                        onClick={() => handleConnectAccount(account.country, account.region, account.SpAPIrefreshTokenStatus)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl font-medium text-sm whitespace-nowrap ${buttonInfo.color.replace('bg-gradient-to-r ', 'bg-').replace('hover:from-', 'hover:bg-').replace('hover:to-', '').replace('from-', '').replace('to-', '').replace('via-', '')}`}
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
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-2xl flex items-center justify-center mx-auto mb-3 border border-[#30363d]">
              <Link className="w-8 h-8 text-gray-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-100 mb-2">No accounts connected</h3>
            <p className="text-gray-400 mb-4 max-w-md mx-auto text-sm">
              Connect your Amazon seller account to start analyzing your business performance and get insights.
            </p>
            <button
              onClick={() => handleConnectAccount('', '')}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl mx-auto"
            >
              <Plus className="w-4 h-4" />
              Connect Your First Account
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
