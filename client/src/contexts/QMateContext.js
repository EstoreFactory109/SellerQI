import { createContext, useContext } from 'react';

/**
 * Lets any component ask QMate about the specific thing the seller is looking at.
 *
 * The chat drawer is mounted once in MainPagesLayout, but the rows that want to
 * open it (a top fix, a product to fix, a task) render several levels down through
 * <Outlet />, so they have no route to that state. This context carries the one
 * function they need.
 *
 * Deliberately safe when no provider is present: `askQMate` is null, and
 * AskQMateTag renders nothing rather than throwing. That keeps pages usable
 * outside the layout (and in unit tests) without every caller adding a guard.
 */
export const QMateContext = createContext({ askQMate: null });

/**
 * @returns {{askQMate: ((question: string) => void)|null}}
 */
export function useQMate() {
    return useContext(QMateContext);
}

export default QMateContext;
