/**
 * App-wide currency DISPLAY setting. Changing it swaps the symbol/code
 * everywhere <Amount> and the formatter appear — it never touches stored
 * amounts (which are always integer minor units).
 *
 * On load and on change it also updates the module-level active symbol in
 * money.ts, so non-component formatters (describeNet, settle-up messages,
 * bill-split preview) stay correct without threading the symbol through.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { getCurrencyCode, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { DEFAULT_CURRENCY_CODE, setActiveCurrencySymbol, symbolForCurrency } from '@/domain/money';

interface CurrencyState {
  code: string;
  symbol: string;
  setCurrency: (code: string) => Promise<void>;
  /** Re-read the setting from the DB (after restore / clear). */
  reload: () => Promise<void>;
}

const CurrencyContext = createContext<CurrencyState>({
  code: DEFAULT_CURRENCY_CODE,
  symbol: symbolForCurrency(DEFAULT_CURRENCY_CODE),
  setCurrency: async () => {},
  reload: async () => {},
});

export function CurrencyProvider({ children }: PropsWithChildren) {
  const [code, setCode] = useState<string>(DEFAULT_CURRENCY_CODE);

  const apply = useCallback((next: string) => {
    setActiveCurrencySymbol(symbolForCurrency(next));
    setCode(next);
  }, []);

  const reload = useCallback(async () => {
    apply(await getCurrencyCode());
  }, [apply]);

  useEffect(() => {
    getCurrencyCode().then(apply).catch(() => {});
  }, [apply]);

  const setCurrency = useCallback(
    async (next: string) => {
      await setSetting(SETTINGS_KEYS.defaultCurrency, next);
      apply(next);
    },
    [apply],
  );

  return (
    <CurrencyContext.Provider value={{ code, symbol: symbolForCurrency(code), setCurrency, reload }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext);
}
