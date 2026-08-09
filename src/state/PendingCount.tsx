/**
 * App-wide pending-transaction count — feeds the Queue tab badge (design §6)
 * and stays fresh because every mutation site calls `refresh()`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { countPendingTransactions } from '@/db/queries/transactions';

interface PendingCountState {
  count: number;
  refresh: () => void;
}

const PendingCountContext = createContext<PendingCountState>({ count: 0, refresh: () => {} });

export function PendingCountProvider({ children }: PropsWithChildren) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    countPendingTransactions()
      .then(setCount)
      .catch(() => {}); // badge is cosmetic — never crash over it
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <PendingCountContext.Provider value={{ count, refresh }}>
      {children}
    </PendingCountContext.Provider>
  );
}

export function usePendingCount(): PendingCountState {
  return useContext(PendingCountContext);
}
