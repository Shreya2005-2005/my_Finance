/**
 * THE KINDS OF MUTUAL FUND WE RANK.
 *
 * Each has a plain-words description for the page, and a name pattern used to find every fund of that kind in
 * the full list of Indian schemes. (The data source labels categories inconsistently, so we match on the
 * scheme's name, then confirm the fund has enough history and a fresh price.)
 */
export type FundGroup = "equity" | "index" | "tax" | "debt" | "hybrid" | "gold";
export type RiskLevel = "Low" | "Low to medium" | "Medium" | "Medium to high" | "High" | "Very high";

export interface FundType {
  id: string;
  label: string;
  group: FundGroup;
  /** One or two plain sentences for someone who has never invested. */
  description: string;
  risk: RiskLevel;
  /** How long money should usually stay in it. */
  horizon: string;
  /** Matches the scheme names of this kind of fund. */
  pattern: RegExp;
  /** Names that match the pattern but are a different kind of fund. */
  exclude?: RegExp;
}

export const GROUPS: Array<{ id: FundGroup | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "equity", label: "Shares (equity)" },
  { id: "index", label: "Index" },
  { id: "tax", label: "Tax saving" },
  { id: "debt", label: "Safe and steady (debt)" },
  { id: "hybrid", label: "Mixed (hybrid)" },
  { id: "gold", label: "Gold" },
];

export const FUND_TYPES: FundType[] = [
  {
    id: "flexi",
    label: "Flexi cap",
    group: "equity",
    description: "Invests in companies of any size. The fund manager decides the mix, so it is a good all-round start for long-term money.",
    risk: "High",
    horizon: "5 years or more",
    pattern: /flexi\s?cap/i,
  },
  {
    id: "large",
    label: "Large cap",
    group: "equity",
    description: "Big, well-known companies. It usually swings less than mid or small cap funds, but it can still fall in a bad market.",
    risk: "Medium to high",
    horizon: "5 years or more",
    pattern: /large\s?cap/i,
    exclude: /mid|small|multi|index|nifty|sensex|etf|bluechip.*(index)/i,
  },
  {
    id: "mid",
    label: "Mid cap",
    group: "equity",
    description: "Medium-sized companies that can grow faster than big ones, and also fall harder.",
    risk: "High",
    horizon: "7 years or more",
    pattern: /mid\s?cap/i,
    exclude: /large|small|multi|index|nifty|etf|next\s?50/i,
  },
  {
    id: "small",
    label: "Small cap",
    group: "equity",
    description: "Small companies with the highest growth potential and the biggest swings. Only for money you can leave for a long time.",
    risk: "Very high",
    horizon: "7 years or more",
    pattern: /small\s?cap/i,
    exclude: /index|nifty|etf|momentum|quality|250|50 /i,
  },
  {
    id: "multi",
    label: "Multi cap",
    group: "equity",
    description: "Must hold a mix of large, mid and small companies, so the spread is built in.",
    risk: "High",
    horizon: "5 years or more",
    pattern: /multi\s?cap/i,
    exclude: /index|nifty|etf/i,
  },
  {
    id: "elss",
    label: "Tax saving (ELSS)",
    group: "tax",
    description: "A share-based fund whose investment qualifies for a tax deduction under Section 80C (old tax regime). Your money is locked in for 3 years.",
    risk: "High",
    horizon: "3 years minimum (lock-in)",
    pattern: /elss|tax\s?saver|tax\s?advantage|tax\s?plan/i,
  },
  {
    id: "index",
    label: "Index funds (Nifty 50)",
    group: "index",
    description: "Simply copies the Nifty 50 (India's 50 biggest companies). No manager picking shares, so the cost is low.",
    risk: "Medium to high",
    horizon: "5 years or more",
    pattern: /nifty\s?50/i,
    exclude: /next|equal|value|momentum|quality|alpha|low\s?vol|etf|arbitrage|\bfof\b|fund of fund|midcap|smallcap|100|500|midcap/i,
  },
  {
    id: "liquid",
    label: "Liquid funds",
    group: "debt",
    description: "For parking money for days or weeks. Very low risk and easy to withdraw, but returns are modest.",
    risk: "Low",
    horizon: "A few days to 1 year",
    pattern: /liquid/i,
    exclude: /etf|overnight|index|gold|nifty/i,
  },
  {
    id: "shortdur",
    label: "Short duration funds",
    group: "debt",
    description: "Lends to companies and the government for about 1 to 3 years. Steadier than share funds, with returns usually above a savings account.",
    risk: "Low to medium",
    horizon: "1 to 3 years",
    pattern: /short\s?(duration|term)/i,
    exclude: /ultra|low|money|medium|long|etf|index/i,
  },
  {
    id: "corpbond",
    label: "Corporate bond funds",
    group: "debt",
    description: "Mostly lends to high-rated companies. A step up in risk and return from liquid funds.",
    risk: "Low to medium",
    horizon: "3 years or more",
    pattern: /corporate\s?bond/i,
    exclude: /etf|index|target|fmp|series/i,
  },
  {
    id: "balanced",
    label: "Balanced advantage funds",
    group: "hybrid",
    description: "Shifts between shares and bonds automatically as markets move, aiming for fewer sharp falls.",
    risk: "Medium",
    horizon: "3 years or more",
    pattern: /balanced\s?advantage|dynamic\s?asset/i,
    exclude: /\bfof\b|fund of fund|etf/i,
  },
  {
    id: "aggressive",
    label: "Aggressive hybrid funds",
    group: "hybrid",
    description: "About two-thirds to four-fifths in shares and the rest in bonds. More growth than balanced funds, with bigger swings.",
    risk: "Medium to high",
    horizon: "5 years or more",
    pattern: /aggressive\s?hybrid/i,
    exclude: /\bfof\b|fund of fund|passive|etf/i,
  },
  {
    id: "gold",
    label: "Gold funds",
    group: "gold",
    description: "Follow the price of gold. People use gold to balance share-market risk. The price can fall for years too.",
    risk: "Medium",
    horizon: "5 years or more",
    pattern: /gold/i,
    exclude: /etf(?!\s*fof)|exchange traded|silver|\bsgb\b|bond|equity|miner|mining|sector|international\s?gold\s?mining/i,
  },
];

export const typeById = (id: string): FundType | undefined => FUND_TYPES.find((t) => t.id === id);

export const RISK_TONE: Record<RiskLevel, string> = {
  Low: "good",
  "Low to medium": "good",
  Medium: "info",
  "Medium to high": "warn",
  High: "warn",
  "Very high": "bad",
};

/** Ranking styles, in everyday words. The ids are the engine's profile names. */
export const RANK_STYLES = [
  { id: "balanced", label: "Balanced", hint: "A mix of return, steadiness and consistency." },
  { id: "growth", label: "Highest growth", hint: "Favours long-term and SIP returns over safety." },
  { id: "value", label: "Steady and consistent", hint: "Favours funds that do well year after year." },
  { id: "quality", label: "Lowest risk", hint: "Favours small falls and small swings." },
] as const;
