import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bot, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';

export default function LoginPage() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const email = `${username}@miaoda.com`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return toast.error('Username is required');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return toast.error('Username: only letters, digits, underscore');
    if (password.length < 6) return toast.error('Password must be at least 6 characters');
    if (!isLogin && !agreed) return toast.error('Please accept the User Agreement and Privacy Policy');

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back!');
        navigate('/');
      } else {
        const { data: signUpData, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // Save username into the profiles table after signup
        if (signUpData.user) {
          await supabase
            .from('profiles')
            .upsert({ id: signUpData.user.id, username, email, updated_at: new Date().toISOString() });
        }
        toast.success('Account created! You are now logged in.');
        navigate('/');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      toast.error(msg.includes('Invalid login credentials') ? 'Invalid username or password' : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Background grid decoration */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(hsl(191 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(191 100% 50%) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded border border-primary/30 bg-primary/10 glow-cyan">
            <Bot className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground text-balance">AutoTradeBot</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">AI-Powered Crypto Trading System</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded border border-border bg-card p-6">
          {/* Tabs */}
          <div className="mb-6 flex gap-1 rounded border border-border bg-muted/30 p-0.5">
            {['Login', 'Register'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setIsLogin(tab === 'Login')}
                className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors duration-150 ${
                  (isLogin && tab === 'Login') || (!isLogin && tab === 'Register')
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-normal">Username</Label>
              <Input
                id="username"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="bg-input border-border text-base"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-normal">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  className="bg-input border-border pr-10 text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className="flex min-h-12 items-start gap-2.5 pt-1">
                <Checkbox
                  id="agree"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(!!v)}
                  className="mt-0.5 shrink-0"
                />
                <label htmlFor="agree" className="text-xs leading-relaxed text-muted-foreground">
                  I agree to the{' '}
                  <span className="cursor-pointer text-primary hover:underline">User Agreement</span>
                  {' '}and{' '}
                  <span className="cursor-pointer text-primary hover:underline">Privacy Policy</span>
                </label>
              </div>
            )}

            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-2">Please wait...</span></>
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
            >
              {isLogin ? 'Register' : 'Sign In'}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground/50">
          © 2026 AutoTradeBot · Crypto trading involves risk
        </p>
      </div>
    </div>
  );
}
