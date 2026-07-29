import React, { useState } from "react";
import { useSelector } from "react-redux";
import { MessageCircle, ExternalLink } from "lucide-react";
import axiosInstance from "../../../config/axios.config";

/**
 * Connect WhatsApp card (additive).
 *
 * Mints a one-time link token from the authenticated web session and opens a
 * wa.me deep link pre-filled with "LINK-<token>". Sending that message from the
 * user's WhatsApp completes the account binding on the server webhook. After
 * that, the user can chat with QMate directly from WhatsApp.
 */
export default function ConnectWhatsApp() {
  const user = useSelector((state) => state.Auth.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axiosInstance.post("/api/whatsapp/mint-link-token");
      const data = response?.data?.data || {};

      // Prefer the server-built deep link (authoritative bot number); fall back
      // to building it from the public env var if provided.
      let deepLink = data.deepLink;
      if (!deepLink) {
        const botNumber = import.meta.env.VITE_WHATSAPP_BOT_NUMBER;
        if (botNumber && data.token) {
          deepLink = `https://wa.me/${botNumber}?text=${encodeURIComponent(`LINK-${data.token}`)}`;
        }
      }

      if (!deepLink) {
        setError("WhatsApp is not configured yet. Please try again later.");
        return;
      }

      window.open(deepLink, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error creating WhatsApp link:", err);
      setError(
        err?.response?.data?.message ||
          "Failed to start WhatsApp connection. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden mt-6">
      {/* Header */}
      <div className="bg-emerald-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-2 h-6 bg-emerald-400 rounded-full"></div>
          <div className="flex items-center gap-3">
            <MessageCircle className="w-5 h-5 text-white" />
            <h2 className="text-xl font-bold text-white">Chat with QMate on WhatsApp</h2>
          </div>
        </div>
        <p className="text-emerald-50 text-xs">
          Connect your WhatsApp to ask QMate about your Amazon business right from your chats
        </p>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-300">
            Tap connect to open WhatsApp with a pre-filled message. Send it to link this
            account{user?.whatsapp ? ` (WhatsApp on file: ${user.whatsapp})` : ""}. You can
            disconnect anytime by sending <span className="font-semibold">"unlink"</span> in the chat.
          </p>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
          >
            <MessageCircle className="w-4 h-4" />
            {loading ? "Opening WhatsApp..." : "Connect WhatsApp"}
            {!loading && <ExternalLink className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
