import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, X as XIcon, AlertCircle, CheckCircle2, RefreshCw, FolderGit2, Unlink } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/**
 * Connect an ESF client to an existing Zoho project.
 *
 * Projects are created in Zoho, never here — this picker only links one. With
 * no search term the server returns projects whose names resemble the client's
 * brand (falling back to the newest); typing searches by name. See
 * server/Services/Zoho/ZohoProjectLinks.js.
 */
const SEARCH_DEBOUNCE_MS = 300;

const StatusChip = ({ status }) => {
    if (!status) return null;
    const active = String(status).toLowerCase() === 'active';
    return (
        <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={
                active
                    ? { background: 'rgba(34,197,94,.14)', color: '#22C55E' }
                    : { background: 'rgba(255,255,255,.06)', color: '#A5AEC0' }
            }
        >
            {status}
        </span>
    );
};

const ProjectRow = ({ project, isLinked, onConnect, connecting, disabled }) => (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-white/20 transition-colors">
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-gray-100">{project.name}</p>
                <StatusChip status={project.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
                {project.ownerName || 'No owner'}
                {typeof project.openTaskCount === 'number' && ` · ${project.openTaskCount} open task${project.openTaskCount === 1 ? '' : 's'}`}
            </p>
            {/* Not a blocker — just makes an accidental double-link visible. */}
            {project.linkedToClientName && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-400">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Already connected to {project.linkedToClientName}
                </p>
            )}
        </div>

        {isLinked ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
            </span>
        ) : (
            <button
                type="button"
                onClick={() => onConnect(project)}
                disabled={disabled}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Connect'}
            </button>
        )}
    </div>
);

export default function EsfConnectProjectModal({ client, onClose, onChanged }) {
    const [search, setSearch] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [unlinking, setUnlinking] = useState(false);
    // Bumped by the Refresh button; also the key that lets an in-flight response
    // from a stale keystroke be discarded below.
    const requestRef = useRef(0);

    const load = useCallback(async ({ term, refresh = false } = {}) => {
        const requestId = ++requestRef.current;
        try {
            setLoading(true);
            setError('');
            const res = await axiosInstance.get(`/app/esf/clients/${client._id}/project-options`, {
                params: { search: term || '', ...(refresh ? { refresh: 'true' } : {}) },
            });
            // A slower earlier request must not overwrite a newer one's results.
            if (requestId !== requestRef.current) return;
            setData(res.data?.data || null);
        } catch (err) {
            if (requestId !== requestRef.current) return;
            setError(err.response?.data?.message || 'Could not load projects from Zoho');
        } finally {
            if (requestId === requestRef.current) setLoading(false);
        }
    }, [client._id]);

    // Debounced so a search does not fire a Zoho-backed request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => load({ term: search }), search ? SEARCH_DEBOUNCE_MS : 0);
        return () => clearTimeout(timer);
    }, [search, load]);

    const handleConnect = async (project) => {
        try {
            setBusyId(project.id);
            setError('');
            await axiosInstance.post(`/app/esf/clients/${client._id}/project`, { projectId: project.id });
            onChanged?.();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not connect the project');
            setBusyId(null);
        }
    };

    const handleDisconnect = async () => {
        try {
            setUnlinking(true);
            setError('');
            await axiosInstance.delete(`/app/esf/clients/${client._id}/project`);
            onChanged?.();
            await load({ term: search });
        } catch (err) {
            setError(err.response?.data?.message || 'Could not disconnect the project');
        } finally {
            setUnlinking(false);
        }
    };

    const linked = data?.linked;
    const list = data?.searched ? data.results : (data?.suggestions || []);
    const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim();

    return (
        <div
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#101722] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3 border-b border-white/10 p-5">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10">
                        <FolderGit2 className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-gray-100">Connect a project</h3>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                            {clientName}
                            {client.brandName ? ` · ${client.brandName}` : ''}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-white/5 hover:text-gray-300">
                        <XIcon className="h-4 w-4" />
                    </button>
                </div>

                {/* Zoho not connected — nothing in this modal can work, so say so plainly. */}
                {data && !data.zohoConnected ? (
                    <div className="p-5">
                        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                            <p className="text-xs leading-relaxed text-amber-200">
                                Zoho Projects isn&rsquo;t connected yet. An owner or admin can connect it from
                                <span className="font-medium"> Estore Factory → Zoho Projects</span>, then projects will show up here.
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-3 border-b border-white/10 p-5 pb-4">
                            {linked?.projectId && (
                                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5">
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-gray-100">{linked.projectName}</p>
                                        <p className="text-[11px] text-gray-500">Currently connected</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDisconnect}
                                        disabled={unlinking}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
                                    >
                                        {unlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                                        Disconnect
                                    </button>
                                </div>
                            )}

                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                                <input
                                    autoFocus
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search projects by name…"
                                    className="w-full rounded-xl border border-white/10 bg-[#0b0f17] py-2.5 pl-9 pr-3 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/50"
                                />
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
                            {error && (
                                <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                                    <p className="text-xs text-red-300">{error}</p>
                                </div>
                            )}

                            {!data?.searched && list.length > 0 && (
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                                    {data?.matchedByName ? 'Suggested for this client' : 'Recently created'}
                                </p>
                            )}

                            {loading && !data ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
                                </div>
                            ) : list.length === 0 ? (
                                <p className="py-10 text-center text-sm text-gray-500">
                                    {data?.searched ? `No projects match “${search}”.` : 'No projects found in Zoho.'}
                                </p>
                            ) : (
                                <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
                                    {list.map((project) => (
                                        <ProjectRow
                                            key={project.id}
                                            project={project}
                                            isLinked={linked?.projectId === project.id}
                                            onConnect={handleConnect}
                                            connecting={busyId === project.id}
                                            disabled={!!busyId}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
                            <p className="flex-1 text-[11px] text-gray-500">
                                {data?.totalProjects ? `${data.totalProjects} projects in ${data.portalName || 'Zoho'}` : ''}
                            </p>
                            {/* Projects are cached for 5 minutes; this is the escape hatch for
                                one that was created in Zoho moments ago. */}
                            <button
                                type="button"
                                onClick={() => load({ term: search, refresh: true })}
                                disabled={loading}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
