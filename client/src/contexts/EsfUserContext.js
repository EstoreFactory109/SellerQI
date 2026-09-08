import { createContext, useContext } from 'react';

/** The signed-in ESF staff member, provided by ProtectedEsfRouteWrapper. */
export const EsfUserContext = createContext(null);

export const useEsfUser = () => useContext(EsfUserContext);
