export type Freq = "monthly" | "quarterly" | "semiannual" | "annual";

export interface Card {
  id: string;
  name: string;
  color: string;
  annual_fee: number;
  plaid_account_id: string | null;
  sort: number;
}

export interface Benefit {
  id: string;
  card_id: string;
  name: string;
  value: number;
  freq: Freq;
  match_terms: string;
  sort: number;
}

export interface Claim {
  id: string;
  benefit_id: string;
  period: string;
  source: "manual" | "plaid";
  amount: number | null;
  dismissed: boolean;
}

export interface PlaidItem {
  id: string;
  item_id: string;
  institution_name: string | null;
  status: string;
  last_synced_at: string | null;
}

export interface PlaidAccount {
  account_id: string;
  item_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
}

export interface Txn {
  transaction_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  amount: number; // Plaid sign convention: negative = credit / money in
  name: string | null;
  merchant_name: string | null;
  original_description: string | null;
  pending: boolean;
  benefit_id: string | null;
  ignored: boolean;
}
