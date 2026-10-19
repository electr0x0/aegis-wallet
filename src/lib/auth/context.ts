import { AsyncLocalStorage } from "node:async_hooks";
import type { Hex } from "viem";

export type AccountContext = {
  id: string;
  key: Hex;
  // Only the master account uses the environment's guard. New wallets are EOAs.
  guard: boolean;
  onboardingRecipient?: Hex;
};
const storage = new AsyncLocalStorage<AccountContext>();
export const currentAccount = () => storage.getStore();
export const currentAccountId = () => currentAccount()?.id ?? "master";
export function withAccount<T>(context: AccountContext, fn: () => T): T {
  return storage.run(context, fn);
}
export function belongsToAccount(item: { accountId?: string }): boolean {
  return (item.accountId ?? "master") === currentAccountId();
}
