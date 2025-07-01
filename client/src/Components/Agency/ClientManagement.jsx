import React, { useState, useEffect } from 'react';
import { Users, Plus, RefreshCw, Eye } from 'lucide-react';
import agencyService from '../../services/agencyService';
import AgencyClientRegistrationForm from './AgencyClientRegistrationForm';
import BeatLoader from "react-spinners/BeatLoader";

const ClientManagement = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [switchingClient, setSwitchingClient] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const response = await agencyService.getClients();
      setClients(response.data || []);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchClient = async (clientId) => {
    try {
      setSwitchingClient(clientId);
      await agencyService.switchToClient(clientId);
      // Redirect to connect to amazon page after switching to client
      window.location.href = '/connect-to-amazon';
    } catch (error) {
      setError(error.message);
    } finally {
      setSwitchingClient(null);
    }
  };

  const handleClientAdded = (newClient) => {
    setShowAddForm(false);
    fetchClients(); // Refresh the list
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <BeatLoader color="#3B82F6" size={8} />
      </div>
    );
  }

  if (showAddForm) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <button
            onClick={() => setShowAddForm(false)}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            ← Back to Client List
          </button>
        </div>
        <AgencyClientRegistrationForm
          onSuccess={handleClientAdded}
          onCancel={() => setShowAddForm(false)}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center">
              <Users className="w-6 h-6 mr-2" />
              Client Management
            </h2>
            <p className="text-gray-600 mt-1">
              Manage your agency clients and switch between accounts
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchClients}
              disabled={loading}
              className="flex items-center px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {clients.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No clients yet</h3>
          <p className="text-gray-600 mb-4">
            Start by adding your first client to begin managing their Amazon accounts.
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Client
          </button>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              Your Clients ({clients.length})
            </h3>
          </div>
          <div className="divide-y divide-gray-200">
            {clients.map((client) => (
              <div
                key={client.clientId}
                className="px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">
                          {client.firstName} {client.lastName}
                        </h4>
                        <p className="text-sm text-gray-600">{client.email}</p>
                      </div>
                      <div className="ml-4 text-sm text-gray-500">
                        <div className="flex items-center space-x-4">
                          <span>{client.country} ({client.region})</span>
                          <span>Added {formatDate(client.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center text-xs text-gray-500">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {client.selling_partner_id || 'Not connected'}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4">
                    <button
                      onClick={() => handleSwitchClient(client.clientId)}
                      disabled={switchingClient === client.clientId}
                      className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded ${
                        switchingClient === client.clientId
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      }`}
                    >
                      {switchingClient === client.clientId ? (
                        <>
                          <BeatLoader size={3} color="#6B7280" />
                          <span className="ml-2">Switching...</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3 h-3 mr-1" />
                          Switch To
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientManagement; 