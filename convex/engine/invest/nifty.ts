/**
 * The Nifty 50: India's 50 largest listed companies (NSE). This is our stock universe for the "top stocks" lists.
 * The index changes twice a year, so this list is reviewed by hand; a company that left the index is simply
 * still a large, well-known stock. Symbols are NSE symbols (Yahoo adds ".NS").
 */
export interface NiftyStock {
  symbol: string;
  name: string;
  sector: string;
}

export const NIFTY_50: NiftyStock[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy" },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks" },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Banks" },
  { symbol: "INFY", name: "Infosys", sector: "IT" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom" },
  { symbol: "SBIN", name: "State Bank of India", sector: "Banks" },
  { symbol: "ITC", name: "ITC", sector: "Consumer goods" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "Consumer goods" },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Construction" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Banks" },
  { symbol: "AXISBANK", name: "Axis Bank", sector: "Banks" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Finance" },
  { symbol: "MARUTI", name: "Maruti Suzuki", sector: "Cars" },
  { symbol: "SUNPHARMA", name: "Sun Pharma", sector: "Medicines" },
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Cars" },
  { symbol: "NTPC", name: "NTPC", sector: "Power" },
  { symbol: "TITAN", name: "Titan Company", sector: "Consumer goods" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Cement" },
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Consumer goods" },
  { symbol: "HCLTECH", name: "HCL Technologies", sector: "IT" },
  { symbol: "POWERGRID", name: "Power Grid", sector: "Power" },
  { symbol: "ONGC", name: "ONGC", sector: "Energy" },
  { symbol: "TMPV", name: "Tata Motors Passenger Vehicles", sector: "Cars" },
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Metals" },
  { symbol: "WIPRO", name: "Wipro", sector: "IT" },
  { symbol: "COALINDIA", name: "Coal India", sector: "Energy" },
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Conglomerate" },
  { symbol: "ADANIPORTS", name: "Adani Ports", sector: "Infrastructure" },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Metals" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv", sector: "Finance" },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "Consumer goods" },
  { symbol: "TECHM", name: "Tech Mahindra", sector: "IT" },
  { symbol: "HINDALCO", name: "Hindalco", sector: "Metals" },
  { symbol: "GRASIM", name: "Grasim Industries", sector: "Cement" },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", sector: "Medicines" },
  { symbol: "CIPLA", name: "Cipla", sector: "Medicines" },
  { symbol: "BRITANNIA", name: "Britannia", sector: "Consumer goods" },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Cars" },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Healthcare" },
  { symbol: "SBILIFE", name: "SBI Life Insurance", sector: "Insurance" },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", sector: "Insurance" },
  { symbol: "BPCL", name: "BPCL", sector: "Energy" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", sector: "Consumer goods" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp", sector: "Cars" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", sector: "Banks" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto", sector: "Cars" },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance", sector: "Finance" },
  { symbol: "TRENT", name: "Trent", sector: "Retail" },
  { symbol: "ETERNAL", name: "Eternal (Zomato)", sector: "Internet" },
];
