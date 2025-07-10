import React,{useState} from "react";
import { useSelector } from "react-redux";
import AmazonConnectPopup from "./AmazonConnectPopup";
import { Link, Plus, Globe, ShoppingBag, MapPin, Building } from "lucide-react";

export default function AccountCards() {

  const [open,setOpen]=useState(false)
  const accounts=useSelector(state=>state.AllAccounts?.AllAccounts)
  console.log(accounts)
  const handleRemove = (id) => {
    console.log("Remove account ID:", id);
    // Add your remove logic here
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
        {accounts && accounts.length > 0 ? (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account, index) => (
              <div
                key={account.id}
                className="group bg-white border border-gray-200/80 rounded-2xl p-6 hover:border-gray-300 hover:shadow-lg transition-all duration-300 relative overflow-hidden"
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
                      <h3 className="text-lg font-bold text-gray-900">{account.platform}</h3>
                      <p className="text-sm text-gray-600">{account.username}</p>
                    </div>
                  </div>
                  
                  {/* Status indicator */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                    Connected
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

                {/* Action buttons - hidden for now as per comment in original code */}
                {/*
                <div className="mt-6 pt-4 border-t border-gray-200/80">
                  <button
                    onClick={() => handleRemove(account.id)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
                  >
                    <X className="w-4 h-4" />
                    Remove Account
                  </button>
                </div>
                */}
              </div>
            ))}
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
              onClick={handleAddAccount}
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
