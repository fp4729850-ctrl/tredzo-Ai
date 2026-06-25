import type { ReactNode } from 'react';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import MarketScanPage from './pages/MarketScanPage';
import StrategiesPage from './pages/StrategiesPage';
import SettingsPage from './pages/SettingsPage';
import TradeHistoryPage from './pages/TradeHistoryPage';
import BacktestPage from './pages/BacktestPage';
import AdminPage from './pages/AdminPage';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  { name: 'Dashboard', path: '/', element: <DashboardPage /> },
  { name: 'Market Scan', path: '/market', element: <MarketScanPage /> },
  { name: 'Strategies', path: '/strategies', element: <StrategiesPage /> },
  { name: 'Trade History', path: '/history', element: <TradeHistoryPage /> },
  { name: 'Backtesting', path: '/backtest', element: <BacktestPage /> },
  { name: 'Settings', path: '/settings', element: <SettingsPage /> },
  { name: 'Admin', path: '/admin', element: <AdminPage /> },
  { name: 'Login', path: '/login', element: <LoginPage />, public: true },
  { name: 'Register', path: '/register', element: <LoginPage />, public: true },
];
