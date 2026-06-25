
CREATE TABLE public.backtest_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT '1h',
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- Performance metrics
  total_trades integer NOT NULL DEFAULT 0,
  win_trades integer NOT NULL DEFAULT 0,
  loss_trades integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  total_return_pct numeric NOT NULL DEFAULT 0,
  total_pnl numeric NOT NULL DEFAULT 0,
  max_drawdown_pct numeric NOT NULL DEFAULT 0,
  sharpe_ratio numeric NOT NULL DEFAULT 0,
  avg_trade_duration_hours numeric NOT NULL DEFAULT 0,
  -- JSON payloads for chart data
  equity_curve jsonb NOT NULL DEFAULT '[]',
  trade_list jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own backtest results" ON backtest_results
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own backtest results" ON backtest_results
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own backtest results" ON backtest_results
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins full access to backtest results" ON backtest_results
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);
