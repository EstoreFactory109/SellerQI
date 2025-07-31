import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Link2, ShoppingCart, Settings, Search, Filter, Plus, Eye, Trash2 } from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const AdminAccountIntegrations = () => {
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/admin/clients`, {
        withCredentials: true
      });
      
      if (response.status === 200) {
        const clientsData = response.data.data.map(client => ({
          id: client._id,
          name: `${client.firstName} ${client.lastName}`,
          email: client.email,
          phone: client.phone,
          amazonConnected: client.amazonConnected,
          amazonStatus: client.amazonStatus,
          connectedDate: client.connectedDate,
          marketplace: client.marketplace,
          region: client.region,
          status: client.subscriptionStatus,
          createdAt: client.createdAt
        }));
        setClients(clientsData);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
      setError('Failed to load clients data');
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter(client => {
    const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         client.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || 
                         (filterStatus === 'connected' && client.amazonConnected) ||
                         (filterStatus === 'disconnected' && !client.amazonConnected);
    return matchesSearch && matchesFilter;
  });

  const getStatusConfig = (amazonStatus) => {
    switch (amazonStatus) {
      case 'Connected':
        return {
          color: 'text-green-700',
          bgColor: 'bg-green-100',
          dotColor: 'bg-green-500',
          icon: '✓'
        };
      case 'Seller Central':
        return {
          color: 'text-blue-700',
          bgColor: 'bg-blue-100',
          dotColor: 'bg-blue-500',
          icon: '📊'
        };
      case 'Amazon Ads':
        return {
          color: 'text-yellow-700',
          bgColor: 'bg-yellow-100',
          dotColor: 'bg-yellow-500',
          icon: '📢'
        };
      default: // Not Connected
        return {
          color: 'text-red-700',
          bgColor: 'bg-red-100',
          dotColor: 'bg-red-500',
          icon: '✗'
        };
    }
  };

  const handleViewClient = (clientId) => {
    // TODO: Navigate to client details or switch to client context
    console.log('View client:', clientId);
  };

  const handleRemoveClient = async (clientId) => {
    if (window.confirm('Are you sure you want to remove this client? This action cannot be undone.')) {
      try {
        const response = await axios.delete(`${import.meta.env.VITE_BASE_URI}/app/admin/clients/${clientId}`, {
          withCredentials: true
        });
        
        if (response.status === 200) {
          setClients(clients.filter(c => c.id !== clientId));
        }
      } catch (error) {
        console.error('Error removing client:', error);
        alert('Failed to remove client. Please try again.');
      }
    }
  };

  const handleAddClient = () => {
    navigate('/agency-client-registration');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 rounded-3xl p-8 text-white"
      >
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
            <Link2 className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-2">Client Account Integrations</h1>
            <p className="text-white/80 text-lg">
              Manage Amazon account connections for all your clients
            </p>
          </div>
        </div>
      </motion.div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6"
      >
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search clients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="pl-10 pr-8 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
              >
                <option value="all">All Clients</option>
                <option value="connected">Any Connected</option>
                <option value="disconnected">Not Connected</option>
              </select>
            </div>

            <button 
              onClick={handleAddClient}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Client
            </button>
          </div>
        </div>
      </motion.div>

      {/* Clients Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
      >
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Client Amazon Integrations</h2>
          <p className="text-gray-600 mt-1">{filteredClients.length} clients found</p>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Loading clients...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={fetchClients}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Client
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Amazon Status
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Marketplace
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Connected Date
                </th>
                <th className="px-6 py-4 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{client.name}</div>
                      <div className="text-sm text-gray-500">{client.email}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const statusConfig = getStatusConfig(client.amazonStatus);
                        return (
                          <>
                            <div className={`w-2 h-2 ${statusConfig.dotColor} rounded-full`}></div>
                            <span className={`text-sm font-medium ${statusConfig.color} flex items-center gap-1`}>
                              <span>{statusConfig.icon}</span>
                              {client.amazonStatus || 'Not Connected'}
                            </span>
                            {client.amazonConnected && (
                              <ShoppingCart className="w-4 h-4 text-orange-500" />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div className="flex flex-col">
                      <span>{client.marketplace || 'N/A'}</span>
                      {client.region && (
                        <span className="text-xs text-gray-500">({client.region})</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">
                      {client.connectedDate ? new Date(client.connectedDate).toLocaleDateString() : 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewClient(client.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="View Client"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveClient(client.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove Client"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {filteredClients.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No clients found</h3>
            <p className="text-gray-600">
              {searchTerm ? 'Try adjusting your search terms.' : 'Add your first client to get started.'}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default AdminAccountIntegrations;