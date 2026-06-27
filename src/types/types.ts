export type UserRole = 'user' | 'admin';
export type SignalDirection = 'buy' | 'sell';
export type SignalStatus = 'pending' | 'executed' | 'cancelled' | 'expired';
export type TradeStatus = 'open' | 'closed' | 'cancelled';
export type StrategyStatus = 'active' | 'inactive';

export interface Profile {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  binance_api_key: string | null;
  binance_api_secret: string | null;
  bot_enabled: boolean;
  trading_mode: 'spot' | 'futures';
  min_confidence: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  position_size_pct: number;
  max_open_trades: number;
  use_testnet: boolean;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  whatsapp_enabled: boolean;
  whatsapp_phone: string | null;
  whatsapp_api_key: string | null;
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface StrategyParams {
  strategy_type?: 'rsi_ema' | 'supertrend' | 'smc' | 'mixed';
  rsi_length: number;
  overbought: number;
  oversold: number;
  ema_fast: number;
  ema_slow: number;
  st_multiplier?: number;
  st_lookback?: number;
  rsi_filter_enabled?: boolean;
  rsi_filter_long_level?: number;
  rsi_filter_short_level?: number;
  symbol: string;
  timeframe: string;
  has_stop_loss: boolean;
  has_take_profit: boolean;
  trade_direction: 'long' | 'short' | 'both';
}

export interface Strategy {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  pinescript_code: string;
  ai_interpretation: string | null;
  strategy_params: StrategyParams | null;
  timeframe: string | null;
  symbol: string | null;
  symbols: string[] | null;
  last_executed_at: string | null;
  last_signal: string | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  position_size_pct: number | null;
  tp1_pct: number | null;
  tp2_pct: number | null;
  tp3_pct: number | null;
  tp1_size_pct: number | null;
  tp2_size_pct: number | null;
  tp3_size_pct: number | null;
  trade_amount_usdt: number | null;
  status: StrategyStatus;
  created_at: string;
  updated_at: string;
}

export interface Signal {
  id: string;
  user_id: string;
  strategy_id: string | null;
  symbol: string;
  direction: SignalDirection;
  confidence: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  timeframe: string;
  reason: string | null;
  status: SignalStatus;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  user_id: string;
  signal_id: string | null;
  symbol: string;
  direction: SignalDirection;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  status: TradeStatus;
  binance_order_id: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketScan {
  id: string;
  symbol: string;
  price: number;
  change_pct_24h: number;
  volume_24h: number;
  scan_type: 'gainer' | 'loser';
  signal_direction: SignalDirection | null;
  confidence: number | null;
  timeframe: string;
  scanned_at: string;
}

export interface BacktestTrade {
  entry_time: string;
  exit_time: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  duration_hours: number;
  exit_reason: 'tp' | 'sl' | 'signal';
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
}

export interface BacktestMetrics {
  total_trades: number;
  win_trades: number;
  loss_trades: number;
  win_rate: number;
  total_return_pct: number;
  total_pnl: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  avg_trade_duration_hours: number;
  initial_equity: number;
  final_equity: number;
}

export interface BacktestResult {
  id: string;
  user_id: string;
  strategy_id: string | null;
  name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  win_trades: number;
  loss_trades: number;
  win_rate: number;
  total_return_pct: number;
  total_pnl: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  avg_trade_duration_hours: number;
  initial_equity: number;
  final_equity: number;
  equity_curve: EquityPoint[];
  trade_list: BacktestTrade[];
  /** Downsampled OHLCV bars (max 500) for candlestick chart. Only present on live run results; not persisted to DB. */
  ohlcv_sample?: OHLCVBar[];
  created_at: string;
}

export interface OHLCVBar {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

